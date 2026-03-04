import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../helpers'

/**
 * POST /api/foundry/runs
 *
 * Creates a run on a thread with a given assistant.
 * Body: { threadId, assistantId, ...rest }
 *
 * The azure_ai_search tool authenticates via project connections,
 * so no per-run secret injection is needed.
 *
 * Eval-readiness: the response includes x-thread-id and x-run-id headers
 * so a Python evaluation layer can correlate traces.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { threadId, assistantId, ...rest } = body

    if (!threadId || !assistantId) {
      return NextResponse.json(
        { error: 'threadId and assistantId are required' },
        { status: 400 }
      )
    }

    const headers = await foundryHeaders()

    // If the caller hasn't explicitly set tool_choice, check whether the
    // assistant has azure_ai_search configured and force the search tool.
    // Without this, gpt-4.1 and similar models frequently skip the search
    // tool and answer from training data, resulting in ungrounded responses.
    let toolChoice = rest.tool_choice
    if (!toolChoice) {
      try {
        const assistantResp = await fetch(agentsUrl(`/assistants/${assistantId}`), {
          method: 'GET',
          headers,
          cache: 'no-store',
        })
        if (assistantResp.ok) {
          const assistant = await assistantResp.json()
          const hasSearch = assistant.tools?.some((t: any) => t.type === 'azure_ai_search')
          const hasIndexes = assistant.tool_resources?.azure_ai_search?.indexes?.length > 0
          console.log(`[runs] assistant lookup: hasSearch=${hasSearch}, hasIndexes=${hasIndexes}`)
          if (hasSearch && hasIndexes) {
            toolChoice = { type: 'azure_ai_search' }
          }
        } else {
          console.warn(`[runs] assistant lookup returned ${assistantResp.status}`)
        }
      } catch (lookupErr) {
        // Non-fatal: proceed without forcing tool_choice
        console.warn('Could not look up assistant for tool_choice injection:', lookupErr)
      }
    }

    const runBody: Record<string, unknown> = {
      assistant_id: assistantId,
      ...rest,
    }
    if (toolChoice) {
      runBody.tool_choice = toolChoice
    }

    const response = await fetch(
      agentsUrl(`/threads/${threadId}/runs`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(runBody),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry create-run error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to create run', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data, {
      headers: {
        'x-thread-id': threadId,
        'x-run-id': data.id || '',
      },
    })
  } catch (error) {
    console.error('Error creating run:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
