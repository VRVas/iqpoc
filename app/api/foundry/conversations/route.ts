import { NextResponse } from 'next/server'
import { agentsV2Url, foundryHeaders } from '../helpers'

/**
 * POST /api/foundry/conversations
 *
 * Creates a new conversation (v2 API — replaces threads).
 * In the new API, conversations are created via:
 *   POST {endpoint}/openai/conversations?api-version=2025-11-15-preview
 *
 * Returns: { id: "conv_...", object: "conversation", ... }
 */
export async function POST() {
  try {
    const headers = await foundryHeaders()

    const response = await fetch(
      agentsV2Url('/openai/conversations', 'conversations'),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      }
    )

    const text = await response.text()
    let data: any = {}
    if (text && text.trim().length > 0) {
      try {
        data = JSON.parse(text)
      } catch {
        console.warn('[conversations/v2] Non-JSON response:', text.slice(0, 300))
      }
    }

    if (!response.ok) {
      console.error('[conversations/v2] Create error:', response.status, data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to create conversation', details: data },
        { status: response.status }
      )
    }

    console.log('[conversations/v2] Created:', data.id)
    return NextResponse.json(data, {
      headers: { 'x-conversation-id': data.id || '' },
    })
  } catch (error) {
    console.error('[conversations/v2] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
