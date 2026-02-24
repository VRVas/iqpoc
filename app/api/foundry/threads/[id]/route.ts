import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../../helpers'

/**
 * GET /api/foundry/threads/[id]
 *
 * Retrieves a specific thread.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const headers = await foundryHeaders()

    const response = await fetch(agentsUrl(`/threads/${id}`), {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message || 'Failed to get thread', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error getting thread:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/foundry/threads/[id]
 *
 * Deletes a thread.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const headers = await foundryHeaders()

    const response = await fetch(agentsUrl(`/threads/${id}`), {
      method: 'DELETE',
      headers,
    })

    if (!response.ok) {
      const data = await response.json()
      return NextResponse.json(
        { error: data.error?.message || 'Failed to delete thread', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json({ deleted: true, id })
  } catch (error) {
    console.error('Error deleting thread:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
