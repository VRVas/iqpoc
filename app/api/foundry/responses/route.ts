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
      truncation: 'auto', // Auto-trim old conversation context to prevent context overflow
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
    const requestStartTime = Date.now()

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

        // DEBUG: Log all output item types to understand MCP response structure
        console.log('[responses/v2] Output item types:', finalOutput.map((o: any) => `${o.type}${o.name ? ':' + o.name : ''}${o.server_label ? '@' + o.server_label : ''}`))
        // Log full keys of each item to find hidden fields
        for (const item of finalOutput) {
          console.log(`[responses/v2] Item ${item.type} keys:`, Object.keys(item))
        }
        // Parse MCP KB call outputs to extract source data for the frontend.
        // When the agent uses Foundry-native MCP KB tools, the mcp_call output
        // contains the synthesized answer + source blocks in a specific format:
        //   【N:M†source】 followed by JSON with uid, blob_url, snippet
        // We parse these into _mcpSources for the frontend citation pipeline.
        // Ref: Phase 0 validation (Foundry IQ MCP response structure)
        for (const item of finalOutput) {
          if (item.type === 'mcp_call' && typeof item.output === 'string') {
            console.log('[responses/v2] Found mcp_call item, output length:', item.output.length)
            try {
              // Parse source references from the MCP KB output
              const sources = parseMcpKbSources(item.output)
              if (sources.length > 0) {
                item._mcpSources = sources
                console.log(`[responses/v2] Parsed ${sources.length} MCP sources`)
              }

              // Extract retrieval metadata for the frontend's retrieval summary.
              // The full activity timeline (modelQueryPlanning, searchIndex timing,
              // agenticReasoning, modelAnswerSynthesis) is only available via the
              // direct KB retrieve REST API (used by KB Playground). The MCP path
              // does not surface it. However, we can extract:
              const retrievalMeta: any = {}

              // 1. Query decomposition from MCP call arguments
              const args = typeof item.arguments === 'string'
                ? (() => { try { return JSON.parse(item.arguments) } catch { return {} } })()
                : (item.arguments || {})
              if (args.queries && Array.isArray(args.queries)) {
                retrievalMeta.queries = args.queries
                retrievalMeta.queryCount = args.queries.length
              }

              // 2. Document count from "Retrieved N documents" prefix
              const docCountMatch = item.output.match(/Retrieved (\d+) documents/)
              if (docCountMatch) {
                retrievalMeta.documentCount = parseInt(docCountMatch[1], 10)
              }

              // 3. Source count
              retrievalMeta.sourceCount = sources.length

              // 4. Server label (which KB)
              retrievalMeta.serverLabel = item.server_label || ''
              retrievalMeta.toolName = item.name || 'knowledge_base_retrieve'

              // 5. Elapsed time (measured from request start to now)
              retrievalMeta.elapsedMs = Date.now() - requestStartTime

              // 6. Token usage (from the Foundry Responses API response)
              if (data.usage) {
                retrievalMeta.usage = {
                  prompt_tokens: data.usage.prompt_tokens || data.usage.input_tokens || 0,
                  completion_tokens: data.usage.completion_tokens || data.usage.output_tokens || 0,
                  total_tokens: data.usage.total_tokens || 0,
                }
              }

              item._mcpRetrievalMeta = retrievalMeta
              console.log('[responses/v2] MCP retrieval meta:', JSON.stringify(retrievalMeta))
            } catch (parseErr) {
              console.warn('[responses/v2] MCP source parsing warning:', parseErr)
            }
          }
        }

        data.output = finalOutput
        data._functionCallLoops = loopCount
        data._elapsedMs = Date.now() - requestStartTime

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
        truncation: 'auto',
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
    let block = output.slice(start, end).trim()

    if (!block) continue

    // Try to parse as JSON (source blocks contain { uid, blob_url, snippet })
    // The JSON may contain escaped unicode (\u002B etc.), \r\n, etc.
    let parsed: any = null
    try {
      parsed = JSON.parse(block)
    } catch {
      // Try cleaning: sometimes there's trailing text after the JSON
      // Find the JSON object boundaries { ... }
      const jsonStart = block.indexOf('{')
      const jsonEnd = block.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        try {
          parsed = JSON.parse(block.slice(jsonStart, jsonEnd + 1))
        } catch { /* still not valid JSON */ }
      }
    }

    if (parsed && (parsed.uid || parsed.blob_url || parsed.snippet)) {
      const blobUrl = parsed.blob_url || ''
      // Detect source type: blob storage vs web
      const isWeb = !blobUrl && parsed.snippet && (
        parsed.snippet.includes('http://') || parsed.snippet.includes('https://')
      )
      const sourceType = blobUrl.includes('.blob.core.windows.net/') ? 'azureBlob'
        : isWeb ? 'web'
        : parsed.uid?.startsWith('web_') ? 'web'
        : 'azureBlob'

      const title = deriveTitle(blobUrl || parsed.uid || '')
      // Clean snippet: remove \r\n, excessive whitespace
      const snippet = (parsed.snippet || '')
        .replace(/\\r\\n|\\n|\\r/g, ' ')
        .replace(/\r\n|\n|\r/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 500)

      // Extract URL from snippet if it's a web source (URLs often appear in snippet text)
      let sourceUrl = blobUrl
      if (!sourceUrl && parsed.snippet) {
        const urlMatch = parsed.snippet.match(/https?:\/\/[^\s"'<>\\]+/)
        if (urlMatch) sourceUrl = urlMatch[0]
      }

      sources.push({
        type: sourceType,
        id: String(markers[i].sourceIdx),
        docKey: parsed.uid || '',
        blobUrl: blobUrl,
        url: sourceUrl,
        // For web sources, also set webUrl for the Sources Panel
        ...(sourceType === 'web' ? { webUrl: sourceUrl, title: title } : {}),
        sourceData: {
          title: title,
          snippet: snippet,
          content: snippet,
        },
      })
    } else if (block.length > 20) {
      // Not JSON — synthesized answer text (source 0 is typically the KB answer summary)
      // Clean it up for display
      const cleanBlock = block
        .replace(/\r\n|\n|\r/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .slice(0, 500)

      // Extract a meaningful title from the first sentence
      const firstSentence = cleanBlock.split(/[.!?\n]/).filter(s => s.trim().length > 10)[0]?.trim()
      const title = firstSentence
        ? (firstSentence.length > 80 ? firstSentence.slice(0, 77) + '...' : firstSentence)
        : `KB Synthesized Answer`

      sources.push({
        type: 'searchIndex',
        id: String(markers[i].sourceIdx),
        docKey: 'kb-synthesis',
        sourceData: {
          title: title,
          snippet: cleanBlock,
          content: cleanBlock,
        },
      })
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
    // If it's a blob URL, extract filename
    if (urlOrUid.includes('.blob.core.windows.net/')) {
      const parts = urlOrUid.split('/')
      const filename = decodeURIComponent(parts[parts.length - 1] || '')
      return filename
        .replace(/\.[^.]+$/, '')
        .replace(/[_+]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown Source'
    }

    // If it's a web URL, extract meaningful path segments
    if (urlOrUid.startsWith('http')) {
      const url = new URL(urlOrUid)
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length > 0) {
        const lastPart = decodeURIComponent(pathParts[pathParts.length - 1])
        return lastPart
          .replace(/[-_]/g, ' ')
          .replace(/\.[^.]+$/, '')
          .replace(/\s+/g, ' ')
          .trim() || url.hostname
      }
      return url.hostname
    }

    // If it's a UID, try to extract meaningful text
    // UIDs often have format: hash_base64encodedUrl
    if (urlOrUid.includes('_aHR0')) {
      // Base64 encoded URL in UID — extract the readable part before the hash
      const parts = urlOrUid.split('_')
      if (parts.length > 1) {
        try {
          const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
          return deriveTitle(decoded)
        } catch { /* ignore base64 decode failure */ }
      }
    }

    return urlOrUid.slice(0, 60)
  } catch {
    return urlOrUid.slice(0, 60)
  }
}
