import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../helpers'

/**
 * POST /api/foundry/messages
 *
 * Creates a message within a thread.
 * Body: { threadId, role, content }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { threadId, role, content } = body

    if (!threadId) {
      return NextResponse.json({ error: 'threadId is required' }, { status: 400 })
    }

    const headers = await foundryHeaders()

    const response = await fetch(
      agentsUrl(`/threads/${threadId}/messages`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ role: role || 'user', content }),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry create-message error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to create message', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data, {
      headers: { 'x-thread-id': threadId },
    })
  } catch (error) {
    console.error('Error creating message:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/foundry/messages?threadId=X
 *
 * Lists messages in a thread.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const threadId = searchParams.get('threadId')

    if (!threadId) {
      return NextResponse.json({ error: 'threadId query param is required' }, { status: 400 })
    }

    const headers = await foundryHeaders()

    const response = await fetch(
      agentsUrl(`/threads/${threadId}/messages`),
      {
        method: 'GET',
        headers,
        cache: 'no-store',
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry list-messages error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to list messages', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data, {
      headers: { 'x-thread-id': threadId },
    })
  } catch (error) {
    console.error('Error listing messages:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
