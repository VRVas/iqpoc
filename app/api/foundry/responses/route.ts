import { NextResponse } from 'next/server'
import { agentsV2Url, foundryHeaders, retrieveFromKb } from '../helpers'

/**
 * POST /api/foundry/responses
 *
 * Sends a message and gets an agent response (v2 API).
 *
 * This route implements a **function-call loop** for KB retrieval:
 *
 * 1. Send the user's message to the agent via POST /openai/responses
 * 2. If the response contains a function_call to "knowledge_base_retrieve",
 *    execute the KB retrieval via the Azure AI Search REST API
 * 3. Send the retrieval results back to the agent via a follow-up request
 *    with previous_response_id and function_call_output
 * 4. Repeat until the agent produces a final text response (no more function calls)
 *
 * This approach bypasses the MCP transport entirely (which has a 405 issue
 * due to GET/POST transport mismatch) and uses the proven KB retrieval API.
 *
 * Response shape returned to the client includes both function call info
 * and the final assistant message, so the UI can display the retrieval
 * journey + citations.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { conversationId, agentName, input, knowledgeSourceParams } = body

    if (!conversationId || !agentName || !input) {
      return NextResponse.json(
        { error: 'conversationId, agentName, and input are required' },
        { status: 400 }
      )
    }

    const headers = await foundryHeaders()

    // Initial request payload
    let payload: any = {
      conversation: conversationId,
      input,
      agent: {
        type: 'agent_reference',
        name: agentName,
      },
    }

    console.log('[responses/v2] Sending:', JSON.stringify({
      conversation: conversationId,
      agent: agentName,
      input: input.slice(0, 100) + (input.length > 100 ? '...' : ''),
    }))

    // Collect all output items across the function-call loop
    // so the UI gets the full retrieval journey
    const allOutputItems: any[] = []
    let previousResponseId: string | null = null
    let loopCount = 0
    const MAX_LOOPS = 5 // Safety limit to prevent infinite loops

    while (loopCount < MAX_LOOPS) {
      loopCount++

      const response = await fetch(
        agentsV2Url('/openai/responses', 'responses'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        }
      )

      const text = await response.text()
      let data: any = {}
      if (text && text.trim().length > 0) {
        try {
          data = JSON.parse(text)
        } catch {
          console.warn('[responses/v2] Non-JSON response:', text.slice(0, 500))
        }
      }

      if (!response.ok) {
        console.error('[responses/v2] Error:', response.status, data)
        return NextResponse.json(
          { error: data.error?.message || `Failed to get response (${response.status})`, details: data },
          { status: response.status }
        )
      }

      console.log(`[responses/v2] Loop ${loopCount} — status: ${data.status}, outputs: ${data.output?.length || 0}`)

      previousResponseId = data.id

      // Check if there are function_call items that need processing
      const functionCalls = (data.output || []).filter(
        (item: any) => item.type === 'function_call' && item.name === 'knowledge_base_retrieve'
      )

      if (functionCalls.length === 0) {
        // No more function calls — this is the final response
        // Merge accumulated items from intermediate iterations with the final output
        const finalOutput = [...allOutputItems, ...(data.output || [])]
        data.output = finalOutput
        data._functionCallLoops = loopCount

        console.log('[responses/v2] Final response:', {
          status: data.status,
          totalOutputs: finalOutput.length,
          loops: loopCount,
        })

        return NextResponse.json(data, {
          headers: {
            'x-conversation-id': conversationId,
            'x-response-id': data.id || '',
          },
        })
      }

      // Process function calls: execute KB retrievals
      const functionOutputs: any[] = []

      // Collect non-function-call items from THIS intermediate iteration
      // (messages, code_interpreter_call, etc.) so they aren't lost
      const otherItems = (data.output || []).filter(
        (item: any) => !(item.type === 'function_call' && item.name === 'knowledge_base_retrieve')
      )
      if (otherItems.length > 0) {
        allOutputItems.push(...otherItems)
      }

      for (const fc of functionCalls) {
        // Collect the function call item for the UI
        allOutputItems.push(fc)

        let args: any = {}
        try {
          args = typeof fc.arguments === 'string' ? JSON.parse(fc.arguments) : fc.arguments
        } catch {
          args = { query: input } // fallback to original input
        }

        const query = args.query || input
        const kbName = args.knowledge_base || ''

        console.log(`[responses/v2] Function call: knowledge_base_retrieve(query="${query.slice(0, 80)}", kb="${kbName}")`)

        let retrievalResult: any
        try {
          retrievalResult = await retrieveFromKb(kbName, query, knowledgeSourceParams)
        } catch (err) {
          console.error(`[responses/v2] KB retrieval failed:`, err)
          retrievalResult = {
            error: err instanceof Error ? err.message : 'KB retrieval failed',
            response: [],
            references: [],
            activity: [],
          }
        }

        // Build a compact output string for the agent
        // Include the synthesized answer + references so the agent can cite them
        const retrievalOutput = formatRetrievalForAgent(retrievalResult)

        // Collect the function output item for the UI
        allOutputItems.push({
          type: 'function_call_output',
          call_id: fc.call_id || fc.id,
          output: retrievalOutput,
          _rawRetrieval: retrievalResult, // Keep raw data for UI rendering
        })

        functionOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id || fc.id,
          output: retrievalOutput,
        })
      }

      // Send function outputs back to the agent.
      //
      // IMPORTANT: We use `conversation` (not `previous_response_id`) so that
      // the function_call_output is registered IN the conversation history.
      // Using only `previous_response_id` creates a chained response that
      // doesn't get added to the conversation, which causes the next user
      // message to fail with "No tool output found for function call ..."
      // because the conversation still has an unresolved function_call.
      //
      // The Foundry API does NOT allow both fields simultaneously, so we
      // must choose one. `conversation` is correct here because it ensures
      // the full exchange (function_call → function_call_output → final text)
      // is part of the conversation for subsequent turns.
      payload = {
        conversation: conversationId,
        input: functionOutputs,
        agent: {
          type: 'agent_reference',
          name: agentName,
        },
      }

      console.log(`[responses/v2] Sending ${functionOutputs.length} function output(s) back to agent`)
    }

    // If we exceeded MAX_LOOPS, return what we have
    console.warn(`[responses/v2] Exceeded max function-call loops (${MAX_LOOPS})`)
    return NextResponse.json(
      { error: 'Agent exceeded maximum function call iterations', _loops: loopCount },
      { status: 500 }
    )
  } catch (error) {
    console.error('[responses/v2] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Format KB retrieval results into a concise string for the agent.
 *
 * Includes the synthesized answer (if any) and reference summaries
 * so the agent can incorporate citations in its response.
 */
function formatRetrievalForAgent(result: any): string {
  const parts: string[] = []

  // Include the synthesized answer from the KB
  if (result.response && result.response.length > 0) {
    const responseContent = result.response[0]?.content
    if (responseContent && responseContent.length > 0) {
      const text = responseContent[0]?.text
      if (text) {
        parts.push(`Answer: ${text}`)
      }
    }
  }

  // Include reference summaries for citations
  if (result.references && result.references.length > 0) {
    parts.push('\nSources:')
    for (const ref of result.references.slice(0, 10)) {
      // Derive title from blobUrl, webUrl, docUrl, etc. since sourceData may be null
      let title = ref.sourceData?.title || ref.title || ''
      if (!title && ref.blobUrl) {
        try {
          const filename = decodeURIComponent(ref.blobUrl.split('/').pop() || '')
          title = filename.replace(/\.[^.]+$/, '').replace(/[_+]/g, ' ')
        } catch { title = ref.id || 'Unknown' }
      }
      if (!title && (ref.webUrl || ref.docUrl)) {
        try {
          title = decodeURIComponent((ref.webUrl || ref.docUrl).split('/').pop() || ref.id)
        } catch { title = ref.id || 'Unknown' }
      }
      if (!title) title = ref.docKey || ref.id || 'Unknown'
      const snippet = ref.sourceData?.content
        ? ref.sourceData.content.slice(0, 300)
        : ''
      const score = ref.rerankerScore ? ` (relevance: ${ref.rerankerScore.toFixed(2)})` : ''
      parts.push(`- [${ref.id}] ${title}${score}${snippet ? ': ' + snippet : ''}`)
    }
  }

  // Include activity summary
  if (result.activity && result.activity.length > 0) {
    const searchActs = result.activity.filter((a: any) => a.type === 'retrievalQuery')
    if (searchActs.length > 0) {
      const totalDocs = searchActs.reduce((sum: number, a: any) => sum + (a.count || 0), 0)
      parts.push(`\n[Retrieved ${totalDocs} documents from ${searchActs.length} source(s)]`)
    }
  }

  return parts.join('\n') || 'No results found.'
}
