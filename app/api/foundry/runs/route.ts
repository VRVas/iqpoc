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

    const runBody: Record<string, unknown> = {
      assistant_id: assistantId,
      ...rest,
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
