import { NextResponse } from 'next/server'
import { agentsV2Url, foundryHeaders, ensureMcpConnection, buildMcpTool } from '../helpers'

/**
 * POST /api/foundry/agents
 *
 * Creates a new Foundry agent (v2 API).
 * Body: { name, model, instructions, knowledgeBases?, tools? }
 *
 * For each selected knowledge base, creates a Foundry MCP connection
 * (RemoteTool with ProjectManagedIdentity auth) and adds an MCPTool
 * to the agent's definition. Foundry executes KB retrieval server-side
 * via the MCP endpoint — no function-call loop needed in our app.
 *
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/foundry-iq-connect
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const headers = await foundryHeaders()

    // Build tools array
    const tools: Record<string, unknown>[] = []

    // Add MCP tools for KB retrieval — Foundry executes these server-side
    // Per MS Learn: each KB gets a RemoteTool project connection + MCPTool
    // Ref: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/foundry-iq-connect#create-an-agent-with-the-mcp-tool
    const knowledgeBases: string[] = body.knowledgeBases || []
    for (const kbName of knowledgeBases) {
      try {
        const connectionName = await ensureMcpConnection(kbName)
        tools.push(buildMcpTool(kbName, connectionName))
        console.log(`[agents/v2] Added MCP KB tool for "${kbName}" (connection: ${connectionName})`)
      } catch (err) {
        console.error(`[agents/v2] Failed to create MCP connection for KB "${kbName}":`, err)
        // Continue with other KBs — don't block agent creation
      }
    }

    // Add optional tools
    if (body.tools) {
      for (const tool of body.tools) {
        // Skip azure_ai_search — we're replacing it with MCP
        if (tool.type === 'azure_ai_search') continue
        tools.push(tool)
      }
    }

    // Build the v2 agent creation payload
    // Docs: POST {endpoint}/agents?api-version=v1
    // Body: { name, definition: { kind: "prompt", model, instructions, tools } }
    const payload = {
      name: body.name,
      definition: {
        kind: 'prompt',
        model: body.model || 'gpt-4.1',
        instructions: body.instructions || 'You are a helpful AI assistant.',
        tools: tools.length > 0 ? tools : undefined,
      },
    }

    console.log('[agents/v2] Creating agent:', JSON.stringify(payload, null, 2))

    const response = await fetch(agentsV2Url('/agents'), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    // Parse response safely (may be empty on some error codes)
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
      console.error('[agents/v2] Create error:', response.status, data)
      return NextResponse.json(
        { error: data.error?.message || `Failed to create agent (${response.status})`, details: data },
        { status: response.status }
      )
    }

    console.log('[agents/v2] Created agent:', data.name)
    return NextResponse.json(data)
  } catch (error) {
    console.error('[agents/v2] Error creating agent:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/foundry/agents
 *
 * Lists agents in the project (v2 API).
 * Returns: { value: Agent[] } with name, versions, definition, etc.
 */
export async function GET() {
  try {
    const headers = await foundryHeaders()

    const response = await fetch(agentsV2Url('/agents'), {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('[agents/v2] List error:', data)
      return NextResponse.json(
        { error: data.error?.message || 'Failed to list agents', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[agents/v2] Error listing agents:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
