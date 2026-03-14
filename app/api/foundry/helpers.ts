/**
 * Shared helpers for Foundry Agent Service API routes.
 *
 * Supports BOTH the classic Assistants API (v1 legacy) and the new
 * Foundry Agents v2 API (agents, conversations, responses).
 *
 * NEW API (v2) — used by default:
 *   Agents:         POST/GET/DELETE {endpoint}/agents?api-version=v1
 *   Conversations:  POST {endpoint}/openai/conversations?api-version=2025-11-15-preview
 *   Responses:      POST {endpoint}/openai/responses?api-version=2025-11-15-preview
 *
 * CLASSIC API (deprecated, retained for backward compat):
 *   Assistants/Threads/Runs/Messages with api-version=2025-05-15-preview
 *
 * Design notes (eval-readiness):
 *   Every response that creates or references a conversation includes
 *   `x-conversation-id` headers. A future Python eval layer can
 *   capture these from the Next.js response to correlate Foundry traces
 *   with evaluation datasets without parsing response bodies.
 */

import { getFoundryBearerToken, getArmBearerToken } from '@/lib/token-manager'

const FOUNDRY_PROJECT_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT

/**
 * ARM resource ID for the CognitiveServices project.
 * Used for creating/managing RemoteTool connections via ARM API.
 * Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{account}/projects/{project}
 *
 * NOTE: The Foundry Agent Service reads connections from the CognitiveServices project,
 * NOT the ML workspace. This was a critical discovery during debugging.
 */
const CS_PROJECT_ARM_ID = process.env.FOUNDRY_CS_PROJECT_ARM_ID || ''

// Classic (deprecated) API version — keep for /assistants, /threads, /runs backwards compat
const CLASSIC_API_VERSION = process.env.FOUNDRY_AGENT_API_VERSION || '2025-05-15-preview'

// New Agents v2 API versions (from Microsoft Learn docs)
const AGENTS_API_VERSION = 'v1'                        // For /agents CRUD
const CONVERSATIONS_API_VERSION = '2025-11-15-preview'  // For /openai/conversations
const RESPONSES_API_VERSION = '2025-11-15-preview'      // For /openai/responses

function getBaseUrl(): string {
  if (!FOUNDRY_PROJECT_ENDPOINT) {
    throw new Error('FOUNDRY_PROJECT_ENDPOINT is not configured')
  }
  return FOUNDRY_PROJECT_ENDPOINT.replace(/\/+$/, '')
}

/**
 * Build URL for the NEW Foundry Agents v2 REST API.
 *
 * @example agentsV2Url('/agents')                        → …/agents?api-version=v1
 * @example agentsV2Url('/agents/my-agent')               → …/agents/my-agent?api-version=v1
 * @example agentsV2Url('/openai/conversations', 'conversations') → …/openai/conversations?api-version=2025-11-15-preview
 * @example agentsV2Url('/openai/responses', 'responses') → …/openai/responses?api-version=2025-11-15-preview
 */
export function agentsV2Url(path: string, endpoint: 'agents' | 'conversations' | 'responses' = 'agents'): string {
  const base = getBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const version = endpoint === 'agents' ? AGENTS_API_VERSION
    : endpoint === 'conversations' ? CONVERSATIONS_API_VERSION
    : RESPONSES_API_VERSION
  return `${base}${cleanPath}?api-version=${version}`
}

/**
 * Build URL for the CLASSIC Assistants API (deprecated — use agentsV2Url for new code).
 *
 * @example agentsUrl('/assistants')            → …/assistants?api-version=2025-05-15-preview
 * @example agentsUrl('/threads/t1/runs')       → …/threads/t1/runs?api-version=2025-05-15-preview
 */
export function agentsUrl(path: string): string {
  const base = getBaseUrl()
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}?api-version=${CLASSIC_API_VERSION}`
}

/**
 * Return common headers (Authorization + Content-Type) for an upstream call.
 * The Foundry Agent Service requires Entra ID bearer token auth (not API key).
 * Uses service principal credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET).
 */
export async function foundryHeaders(): Promise<Record<string, string>> {
  const token = await getFoundryBearerToken()
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Build an MCP tool definition for connecting an agent to a Knowledge Base
 * via Foundry IQ (Azure AI Search Knowledge Bases MCP endpoint).
 *
 * NOTE: Currently blocked by 405 Method Not Allowed — the Foundry Agent Service
 * runtime uses GET for MCP tool enumeration but Azure AI Search's MCP endpoint
 * only supports POST (Streamable HTTP transport). Kept for future use when
 * the platform resolves this transport mismatch.
 *
 * @param kbName       Knowledge base name in Azure AI Search
 * @param connectionId Foundry project connection name for the RemoteTool connection
 */
export function buildMcpTool(kbName: string, connectionId: string): Record<string, unknown> {
  const searchEndpoint = (process.env.AZURE_SEARCH_ENDPOINT || '').replace(/\/+$/, '')
  if (!searchEndpoint) {
    throw new Error('AZURE_SEARCH_ENDPOINT is not configured — needed for MCP tool')
  }

  return {
    type: 'mcp',
    server_label: `kb_${kbName.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    server_url: `${searchEndpoint}/knowledgebases/${kbName}/mcp?api-version=2025-11-01-preview`,
    require_approval: 'never',
    allowed_tools: ['knowledge_base_retrieve'],
    project_connection_id: connectionId,
  }
}

/**
 * Build a function tool definition for Knowledge Base retrieval.
 *
 * This is the WORKING alternative to MCP tools. The agent gets a standard
 * function tool that it calls when it needs KB data. Our responses API route
 * intercepts the function_call and queries the KB retrieval API directly.
 *
 * Advantages:
 * - No dependency on MCP transport (avoids the 405 GET/POST mismatch)
 * - Direct KB retrieval via the proven Azure AI Search REST API
 * - Full control over retrieval parameters
 * - Works in both basic and standard agent setups
 *
 * @param kbNames Array of knowledge base names available to the agent
 */
export function buildKbFunctionTool(kbNames: string[]): Record<string, unknown> {
  if (kbNames.length === 0) {
    throw new Error('At least one knowledge base name is required')
  }

  const kbDescription = kbNames.length === 1
    ? `Searches the "${kbNames[0]}" knowledge base.`
    : `Searches one of the available knowledge bases: ${kbNames.map(n => `"${n}"`).join(', ')}.`

  const parameters: Record<string, unknown> = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant information. Be specific and include key terms from the user\'s question.',
      },
      knowledge_base: {
        type: 'string',
        description: `Which knowledge base to search. ${kbDescription}`,
        enum: kbNames,
      },
    },
    required: ['query', 'knowledge_base'],
    additionalProperties: false,
  }

  return {
    type: 'function',
    name: 'knowledge_base_retrieve',
    description:
      'Search knowledge bases for relevant documents and information. ' +
      'Use this tool to find data needed to answer user questions accurately. ' +
      'Always cite the sources used in your response.',
    parameters,
  }
}

/**
 * Call the Azure AI Search Knowledge Base retrieval API directly (server-side).
 *
 * This bypasses MCP entirely and uses the same proven API the KB playground uses.
 * Called by the responses route when the agent invokes knowledge_base_retrieve.
 *
 * @param kbName  Knowledge base name
 * @param query   The search query text
 * @returns       Raw retrieval response from Azure AI Search
 */
export async function retrieveFromKb(kbName: string, query: string): Promise<any> {
  const searchEndpoint = (process.env.AZURE_SEARCH_ENDPOINT || '').replace(/\/+$/, '')
  const apiKey = process.env.AZURE_SEARCH_API_KEY
  const apiVersion = process.env.AZURE_SEARCH_API_VERSION || '2025-11-01-preview'

  if (!searchEndpoint || !apiKey) {
    throw new Error('AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY must be configured')
  }

  const url = `${searchEndpoint}/knowledgebases/${kbName}/retrieve?api-version=${apiVersion}`

  const payload = {
    messages: [
      { role: 'user', content: [{ type: 'text', text: query }] }
    ],
  }

  console.log(`[retrieveFromKb] Querying KB "${kbName}": "${query.slice(0, 100)}"`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`[retrieveFromKb] Failed (${response.status}):`, errorText.slice(0, 500))
    throw new Error(`KB retrieval failed for "${kbName}" (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const data = await response.json()
  console.log(`[retrieveFromKb] ✓ Got ${data.references?.length || 0} references, ${data.activity?.length || 0} activity records`)
  return data
}

/**
 * Get the standard connection name for a KB's RemoteTool connection.
 * Convention: kb-mcp-{kbName}
 */
export function mcpConnectionName(kbName: string): string {
  return `kb-mcp-${kbName.replace(/[^a-zA-Z0-9-]/g, '-')}`
}

/**
 * Ensure a RemoteTool connection exists for a specific Knowledge Base.
 *
 * Per Microsoft Learn docs (foundry-iq-connect), each KB needs a RemoteTool
 * connection with ProjectManagedIdentity auth that targets the KB's MCP endpoint.
 * This function creates the connection idempotently (PUT is create-or-update).
 *
 * IMPORTANT: Connections must be created on the CognitiveServices project
 * (not the ML workspace) — the Foundry Agent Service only reads connections
 * from the CognitiveServices project.
 *
 * NOTE: Currently NOT used in agent routes due to the 405 MCP transport mismatch.
 * The function-tool approach (buildKbFunctionTool + retrieveFromKb) bypasses MCP.
 * Retained for future use when the Foundry Agent Service supports Streamable HTTP.
 *
 * Requires: FOUNDRY_CS_PROJECT_ARM_ID, AZURE_SEARCH_ENDPOINT env vars.
 * Auth: Uses ARM management plane token (https://management.azure.com/.default).
 *
 * @see https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/foundry-iq-connect
 */
export async function ensureMcpConnection(kbName: string): Promise<string> {
  if (!CS_PROJECT_ARM_ID) {
    throw new Error(
      'FOUNDRY_CS_PROJECT_ARM_ID is not configured — needed to create RemoteTool connections. ' +
      'Set it to the ARM resource ID of your CognitiveServices project ' +
      '(e.g., /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{account}/projects/{project})'
    )
  }

  const searchEndpoint = (process.env.AZURE_SEARCH_ENDPOINT || '').replace(/\/+$/, '')
  if (!searchEndpoint) {
    throw new Error('AZURE_SEARCH_ENDPOINT is not configured — needed for MCP connection target')
  }

  const connName = mcpConnectionName(kbName)
  const mcpEndpoint = `${searchEndpoint}/knowledgebases/${kbName}/mcp?api-version=2025-11-01-preview`
  // CognitiveServices project connections use a different API version than ML workspaces
  const armUrl = `https://management.azure.com${CS_PROJECT_ARM_ID}/connections/${connName}?api-version=2025-04-01-preview`

  const armToken = await getArmBearerToken()

  const body = {
    properties: {
      authType: 'ProjectManagedIdentity',
      category: 'RemoteTool',
      target: mcpEndpoint,
      isSharedToAll: true,
      audience: 'https://search.azure.com/',
      metadata: { ApiType: 'Azure' },
    },
  }

  console.log(`[ensureMcpConnection] Creating/updating RemoteTool connection "${connName}" → ${mcpEndpoint}`)

  const response = await fetch(armUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${armToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    console.error(`[ensureMcpConnection] Failed (${response.status}):`, text.slice(0, 500))
    throw new Error(
      `Failed to create RemoteTool connection for KB "${kbName}" (HTTP ${response.status}). ` +
      `Verify FOUNDRY_CS_PROJECT_ARM_ID and that the identity has permissions on the CS project.`
    )
  }

  console.log(`[ensureMcpConnection] ✓ Connection "${connName}" ready`)
  return connName
}

/**
 * Convenience: forward the upstream JSON body as a NextResponse, preserving
 * the HTTP status and injecting tracing headers when provided.
 */
export function forwardResponse(
  upstreamResponse: Response,
  data: unknown,
  tracing?: { conversationId?: string; threadId?: string; runId?: string }
) {
  const { NextResponse } = require('next/server')
  const headers: Record<string, string> = {}
  if (tracing?.conversationId) headers['x-conversation-id'] = tracing.conversationId
  // Legacy compat
  if (tracing?.threadId) headers['x-thread-id'] = tracing.threadId
  if (tracing?.runId) headers['x-run-id'] = tracing.runId

  return NextResponse.json(data, {
    status: upstreamResponse.status,
    headers,
  })
}
