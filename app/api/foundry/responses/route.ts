import { NextResponse } from 'next/server'
import { agentsV2Url, foundryHeaders, retrieveFromKb } from '../helpers'
import { getQatarDateTime } from '@/lib/utils'

/**
 * POST /api/foundry/responses
 *
 * Sends a message and gets an agent response (v2 API).
 *
 * KB retrieval flow:
 * - NEW (MCP): Foundry executes KB retrieval server-side via the MCP connection.
 *   The response arrives complete with mcp_call items containing source data.
 *   No function-call loop needed.
 *   Ref: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/foundry-iq-connect
 *
 * - LEGACY (function tool): If the agent still has the old function tool
 *   (knowledge_base_retrieve), our app catches the function_call, executes
 *   KB retrieval via the Azure AI Search REST API, and sends the result back.
 *   This loop remains for backward compatibility with older agent versions.
 *
 * Response shape returned to the client includes both tool call info
 * (MCP or function) and the final assistant message, so the UI can
 * display sources + citations.
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

    // Inject current UTC+3 (Doha/Qatar) date and time into every request
    // so the agent always knows the current date/time context.
    // NOTE: The Foundry v2 Responses API does NOT allow `instructions` when
    // `agent` is specified (returns 400: "Not allowed when agent is specified").
    // Instead, prepend the timestamp to the user input so the agent sees it in context.
    const qatarDateTime = getQatarDateTime()
    const inputWithDateTime = `[Current date and time (UTC+3, Doha/Qatar): ${qatarDateTime}]\n\n${input}`

    // Initial request payload
    let payload: any = {
      conversation: conversationId,
      input: inputWithDateTime,
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
        const errorMessage = data.error?.message || `Failed to get response (${response.status})`

        // Handle MCP tool errors gracefully instead of crashing the conversation.
        // When the agent passes invalid arguments to an MCP tool (e.g. empty string
        // for an enum param), Foundry returns 400 with type "tool_user_error".
        // Instead of propagating the raw 400 to the client, return it as an
        // assistant message so the conversation can continue.
        if (data.error?.code === 'tool_user_error' || data.error?.type === 'invalid_request_error') {
          console.warn('[responses/v2] MCP tool error (returning as message):', errorMessage.slice(0, 200))
          const toolErrorOutput = [{
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'output_text',
              text: `I encountered an issue calling a tool. Let me try a different approach.\n\n*Technical detail: ${errorMessage.split(':').slice(0, 2).join(':').slice(0, 150)}*`,
            }],
          }]
          return NextResponse.json({
            id: previousResponseId || `err-${Date.now()}`,
            status: 'completed',
            output: [...allOutputItems, ...toolErrorOutput],
            _toolError: true,
          }, {
            headers: { 'x-conversation-id': conversationId },
          })
        }

        console.error('[responses/v2] Error:', response.status, data)
        return NextResponse.json(
          { error: errorMessage, details: data },
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

        // Parse MCP KB call outputs to extract source data for the frontend.
        // When the agent uses Foundry-native MCP KB tools, the mcp_call output
        // contains the synthesized answer + source blocks in a specific format:
        //   【N:M†source】 followed by JSON with uid, blob_url, snippet
        // We parse these into _mcpSources for the frontend citation pipeline.
        // Ref: Phase 0 validation (Foundry IQ MCP response structure)
        for (const item of finalOutput) {
          if (item.type === 'mcp_call' && typeof item.output === 'string') {
            try {
              const sources = parseMcpKbSources(item.output)
              if (sources.length > 0) {
                item._mcpSources = sources
              }
            } catch (parseErr) {
              console.warn('[responses/v2] MCP source parsing warning:', parseErr)
            }
          }
        }

        data.output = finalOutput
        data._functionCallLoops = loopCount

        console.log('[responses/v2] Final response:', {
          status: data.status,
          totalOutputs: finalOutput.length,
          loops: loopCount,
        })

        // Fire-and-forget: log response metadata for evaluation platform
        try {
          const responseText = finalOutput
            .filter((o: any) => o.type === 'message' && o.role === 'assistant')
            .map((o: any) => o.content?.map((c: any) => c.text).join('') || '')
            .join('\n')
          const toolCalls = finalOutput
            .filter((o: any) => o.type === 'function_call' || o.type === 'mcp_call')
            .map((o: any) => ({ name: o.name, type: o.type, arguments: o.arguments }))

          const evalServiceUrl = process.env.EVAL_SERVICE_URL
          if (evalServiceUrl) {
            // Log to eval service response-log (non-blocking)
            // Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#collect-response-ids
            fetch(`${evalServiceUrl}/response-log/log`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                response_id: data.id,
                conversation_id: conversationId,
                agent_name: agentName,
                user_query: input,
                response_text: responseText.slice(0, 5000),
                tool_calls: toolCalls,
                timestamp: new Date().toISOString(),
                has_kb_retrieval: toolCalls.some((t: any) => t.name === 'knowledge_base_retrieve'),
                has_mcp_call: toolCalls.some((t: any) => t.type === 'mcp_call'),
                loop_count: loopCount,
              }),
            }).catch(err => console.warn('[responses/v2] Response log failed (non-critical):', err.message))
          }
        } catch (logErr) {
          console.warn('[responses/v2] Response logging error (non-critical):', logErr)
        }

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

/**
 * Parse MCP KB tool output to extract source references.
 *
 * When Foundry executes a knowledge_base_retrieve MCP call, the output is
 * a text blob structured as:
 *   "Retrieved N documents.[synthesized answer]
 *    【4:0†source】
 *    { uid, blob_url, snippet }
 *    【4:1†source】
 *    { uid, blob_url, snippet }
 *    ..."
 *
 * Each 【N:M†source】 block contains a JSON object with the source document
 * metadata (uid, blob_url, snippet). We parse these into an array that the
 * frontend can use for the Sources Panel.
 *
 * This format was validated in Phase 0 testing against the live Foundry
 * MCP endpoint for the test41miniweb KB.
 */
function parseMcpKbSources(output: string): any[] {
  const sources: any[] = []

  // Split on 【...†source】 markers — each is followed by a JSON object or text
  // The marker format is: 【N:M†source】 where N = message index, M = source index
  const markerRegex = /【(\d+):(\d+)†source】/g
  const markers: { index: number; sourceIdx: number; matchEnd: number }[] = []
  let match: RegExpExecArray | null

  while ((match = markerRegex.exec(output)) !== null) {
    markers.push({
      index: match.index,
      sourceIdx: parseInt(match[2], 10),
      matchEnd: match.index + match[0].length,
    })
  }

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].matchEnd
    const end = i + 1 < markers.length ? markers[i + 1].index : output.length
    const block = output.slice(start, end).trim()

    if (!block) continue

    // Try to parse as JSON (source blocks contain { uid, blob_url, snippet })
    try {
      const parsed = JSON.parse(block)
      sources.push({
        type: 'AzureSearchDoc',
        id: String(markers[i].sourceIdx),
        docKey: parsed.uid || '',
        blobUrl: parsed.blob_url || '',
        sourceData: {
          title: deriveTitle(parsed.blob_url || parsed.uid || ''),
          snippet: parsed.snippet || '',
          content: parsed.snippet || '',
        },
      })
    } catch {
      // Not JSON — might be plain text source content
      if (block.length > 10) {
        sources.push({
          type: 'AzureSearchDoc',
          id: String(markers[i].sourceIdx),
          docKey: '',
          sourceData: {
            title: `Source ${markers[i].sourceIdx + 1}`,
            snippet: block.slice(0, 500),
            content: block.slice(0, 500),
          },
        })
      }
    }
  }

  return sources
}

/**
 * Derive a human-readable title from a blob URL or UID.
 */
function deriveTitle(urlOrUid: string): string {
  if (!urlOrUid) return 'Unknown Source'
  try {
    // Extract filename from blob URL
    const parts = urlOrUid.split('/')
    const filename = decodeURIComponent(parts[parts.length - 1] || '')
    // Remove extension, replace separators with spaces
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[_+]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Unknown Source'
  } catch {
    return urlOrUid.slice(0, 60)
  }
}
