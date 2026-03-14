import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../../helpers'

/**
 * GET /api/foundry/assistants/[id]
 *
 * Retrieves a specific agent (assistant) by ID.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const headers = await foundryHeaders()

    const response = await fetch(agentsUrl(`/assistants/${id}`), {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry get-agent error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to get agent', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error getting agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/foundry/assistants/[id]
 *
 * Updates an existing agent (assistant).
 * Body: { name?, instructions?, model?, tools?, tool_resources? }
 *
 * Injects FOUNDRY_SEARCH_CONNECTION_ID server-side.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const body = await request.json()
    const headers = await foundryHeaders()

    // Inject the connection ID server-side for azure_ai_search indexes
    const connectionId = process.env.FOUNDRY_SEARCH_CONNECTION_ID || 'aikb-search'
    if (body.tool_resources?.azure_ai_search?.indexes) {
      body.tool_resources.azure_ai_search.indexes = body.tool_resources.azure_ai_search.indexes.map(
        (idx: any) => ({ ...idx, index_connection_id: connectionId })
      )
    }

    console.log(`[PATCH assistant] Sending to Foundry (POST):`, JSON.stringify(body, null, 2))

    // Foundry Agent Service uses POST (not PATCH) to modify assistants
    const response = await fetch(agentsUrl(`/assistants/${id}`), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    // Foundry may return empty body on some responses
    const text = await response.text()
    let data: any = {}
    if (text && text.trim().length > 0) {
      try {
        data = JSON.parse(text)
      } catch {
        console.warn('[PATCH assistant] Non-JSON response body:', text.slice(0, 200))
      }
    }

    if (!response.ok) {
      console.error('Foundry update-agent error:', response.status, data)
      return NextResponse.json(
        { error: data.error?.message || `Failed to update agent (${response.status})`, details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error updating agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/foundry/assistants/[id]
 *
 * Deletes an agent (assistant).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const headers = await foundryHeaders()

    const response = await fetch(agentsUrl(`/assistants/${id}`), {
      method: 'DELETE',
      headers,
    })

    if (!response.ok) {
      const data = await response.json()
      console.error('Foundry delete-agent error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to delete agent', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json({ deleted: true, id })
  } catch (error) {
    console.error('Error deleting agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
