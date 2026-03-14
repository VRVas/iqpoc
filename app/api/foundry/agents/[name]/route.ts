import { NextResponse } from 'next/server'
import { agentsV2Url, foundryHeaders, buildKbFunctionTool } from '../../helpers'

/**
 * GET /api/foundry/agents/[name]
 *
 * Retrieves a specific agent by name (v2 API).
 * Returns the agent with its latest version definition.
 */
export async function GET(
  _request: Request,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params
    const headers = await foundryHeaders()

    const response = await fetch(agentsV2Url(`/agents/${encodeURIComponent(name)}`), {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('[agents/v2] Get error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to get agent', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[agents/v2] Error getting agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/foundry/agents/[name]
 *
 * Updates an agent by creating a new version (v2 API).
 * The new Agents API is version-based: every update creates a new version.
 * Body: { model?, instructions?, knowledgeBases?, tools? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params
    const body = await request.json()
    const headers = await foundryHeaders()

    // Build tools array
    const tools: Record<string, unknown>[] = []

    // Add function tool for KB retrieval if knowledge bases are selected
    const knowledgeBases: string[] = body.knowledgeBases || []
    if (knowledgeBases.length > 0) {
      tools.push(buildKbFunctionTool(knowledgeBases))
    }

    // Add optional tools
    if (body.tools) {
      for (const tool of body.tools) {
        if (tool.type === 'azure_ai_search') continue // replaced by function tool
        if (tool.type === 'mcp') continue // replaced by function tool
        tools.push(tool)
      }
    }

    // Create a new version of the agent via POST
    // POST /agents/{name} with definition body creates a new version
    const payload = {
      name,
      definition: {
        kind: 'prompt',
        model: body.model || 'gpt-4.1',
        instructions: body.instructions || 'You are a helpful AI assistant.',
        tools: tools.length > 0 ? tools : undefined,
      },
    }

    console.log(`[agents/v2] Updating agent "${name}":`, JSON.stringify(payload, null, 2))

    const response = await fetch(agentsV2Url(`/agents/${encodeURIComponent(name)}`), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const text = await response.text()
    let data: any = {}
    if (text && text.trim().length > 0) {
      try {
        data = JSON.parse(text)
      } catch {
        console.warn('[agents/v2] Non-JSON response:', text.slice(0, 300))
      }
    }

    if (!response.ok) {
      console.error('[agents/v2] Update error:', response.status, data)
      return NextResponse.json(
        { error: data.error?.message || `Failed to update agent (${response.status})`, details: data },
        { status: response.status }
      )
    }

    console.log(`[agents/v2] Updated agent "${name}" to version:`, data.versions?.latest?.id)
    return NextResponse.json(data)
  } catch (error) {
    console.error('[agents/v2] Error updating agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/foundry/agents/[name]
 *
 * Deletes an agent (v2 API).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { name: string } }
) {
  try {
    const { name } = params
    const headers = await foundryHeaders()

    const response = await fetch(agentsV2Url(`/agents/${encodeURIComponent(name)}`), {
      method: 'DELETE',
      headers,
    })

    if (!response.ok) {
      const text = await response.text()
      let data: any = {}
      try { data = JSON.parse(text) } catch { /* ignore */ }
      console.error('[agents/v2] Delete error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to delete agent', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json({ deleted: true, name })
  } catch (error) {
    console.error('[agents/v2] Error deleting agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
