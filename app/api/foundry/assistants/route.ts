import { NextResponse } from 'next/server'
import { agentsUrl, foundryHeaders } from '../helpers'

/**
 * POST /api/foundry/assistants
 *
 * Creates a new Foundry agent (assistant).
 * Body: { name, instructions, model, tools, tool_resources? }
 *
 * Injects FOUNDRY_SEARCH_CONNECTION_ID server-side so the frontend
 * doesn't need to know the connection name.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const headers = await foundryHeaders()

    // Inject the connection ID server-side for azure_ai_search indexes
    const connectionId = process.env.FOUNDRY_SEARCH_CONNECTION_ID || 'aikb-search'
    let toolResources = body.tool_resources
    if (toolResources?.azure_ai_search?.indexes) {
      toolResources = {
        ...toolResources,
        azure_ai_search: {
          ...toolResources.azure_ai_search,
          indexes: toolResources.azure_ai_search.indexes.map((idx: any) => ({
            ...idx,
            index_connection_id: connectionId,
          })),
        },
      }
    }

    const payload: Record<string, unknown> = {
      name: body.name,
      instructions: body.instructions,
      model: body.model,
      tools: body.tools || [],
    }
    if (toolResources) {
      payload.tool_resources = toolResources
    }

    const response = await fetch(agentsUrl('/assistants'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry create-agent error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to create agent', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error creating agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/foundry/assistants
 *
 * Lists agents (assistants) in the project.
 */
export async function GET() {
  try {
    const headers = await foundryHeaders()

    const response = await fetch(agentsUrl('/assistants'), {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('Foundry list-agents error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to list agents', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error listing agents:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
