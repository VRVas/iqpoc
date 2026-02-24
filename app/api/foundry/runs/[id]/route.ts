import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../../helpers'

/**
 * GET /api/foundry/runs/[id]?threadId=X
 *
 * Retrieves the status of a specific run.
 * The agent-builder polls this endpoint until status is 'completed' or 'failed'.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const { searchParams } = new URL(request.url)
    const threadId = searchParams.get('threadId')

    if (!threadId) {
      return NextResponse.json(
        { error: 'threadId query param is required' },
        { status: 400 }
      )
    }

    const headers = await foundryHeaders()

    const response = await fetch(
      agentsUrl(`/threads/${threadId}/runs/${id}`),
      {
        method: 'GET',
        headers,
        cache: 'no-store',
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry get-run error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to get run status', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data, {
      headers: {
        'x-thread-id': threadId,
        'x-run-id': id,
      },
    })
  } catch (error) {
    console.error('Error getting run status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
