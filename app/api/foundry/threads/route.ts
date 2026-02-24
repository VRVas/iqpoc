import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../helpers'

/**
 * POST /api/foundry/threads
 *
 * Creates a new conversation thread.
 */
export async function POST() {
  try {
    const headers = await foundryHeaders()

    const response = await fetch(agentsUrl('/threads'), {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry create-thread error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to create thread', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data, {
      headers: { 'x-thread-id': data.id || '' },
    })
  } catch (error) {
    console.error('Error creating thread:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
