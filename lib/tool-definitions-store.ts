/**
 * Tool Definitions Store
 *
 * App-side key-value store for tool definitions used by the evaluation platform.
 * Tool definitions follow the OpenAI function-calling schema and are required
 * by evaluators like tool_call_accuracy, tool_selection, tool_input_accuracy,
 * and tool_output_utilization.
 *
 * Per MS Learn: "The tool_definitions field describes the tools available to the
 * agent. It follows the OpenAI function-calling schema — a list of tool objects."
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#tool-definitions-format
 *
 * Storage: config/tool-definitions.json (server-side) with localStorage cache (client-side).
 * New tool definitions are auto-generated when knowledge bases are created.
 */

// OpenAI function-calling schema for a tool definition
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

// Key format: "code_interpreter", "airport_ops", "kb_{kbName}", etc.
export type ToolDefinitionsMap = Record<string, ToolDefinition>

const STORAGE_KEY = 'foundry-iq-tool-definitions'

/**
 * Get all tool definitions from localStorage (client-side).
 * Falls back to empty object if not initialized.
 */
export function getToolDefinitions(): ToolDefinitionsMap {
  if (typeof window === 'undefined') return {}
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

/**
 * Set a single tool definition by key.
 */
export function setToolDefinition(key: string, definition: ToolDefinition): void {
  if (typeof window === 'undefined') return
  const all = getToolDefinitions()
  all[key] = definition
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

/**
 * Remove a tool definition by key.
 */
export function removeToolDefinition(key: string): void {
  if (typeof window === 'undefined') return
  const all = getToolDefinitions()
  delete all[key]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}

/**
 * Initialize the store from the seed file (config/tool-definitions.json).
 * Only seeds if localStorage is empty — doesn't overwrite user edits.
 */
export async function initToolDefinitionsFromSeed(): Promise<void> {
  if (typeof window === 'undefined') return
  const existing = localStorage.getItem(STORAGE_KEY)
  if (existing) return // Already initialized

  try {
    const response = await fetch('/api/tool-definitions')
    if (response.ok) {
      const seed = await response.json()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
    }
  } catch {
    // Seed file not available — start with empty store
  }
}

/**
 * Get tool definitions as an array (the format evaluators expect).
 * Optionally filter by keys.
 */
export function getToolDefinitionsArray(filterKeys?: string[]): ToolDefinition[] {
  const all = getToolDefinitions()
  const keys = filterKeys || Object.keys(all)
  return keys
    .filter(k => k in all)
    .map(k => all[k])
}

/**
 * Generate a tool definition for a knowledge base.
 * Uses the KB name and description to create a meaningful tool definition.
 *
 * Per our design: tool_definition for KBs is formed by concatenating
 * the KB name + description from the creation form.
 */
export function generateKbToolDefinition(kbName: string, description: string): ToolDefinition {
  const sanitizedName = kbName.replace(/[^a-zA-Z0-9_]/g, '_')
  return {
    type: 'function',
    function: {
      name: 'knowledge_base_retrieve',
      description: description || `Search the ${kbName} knowledge base for relevant documents and information.`,
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Search queries to find relevant information in the knowledge base',
          },
        },
        required: ['queries'],
      },
    },
  }
}

/**
 * Auto-generate tool definitions from an agent's definition.
 * Converts the agent's tools array into OpenAI function-calling schema.
 */
export function generateToolDefinitionsFromAgent(agentDefinition: any): ToolDefinitionsMap {
  const result: ToolDefinitionsMap = {}
  const tools = agentDefinition?.tools || agentDefinition?.definition?.tools || []

  for (const tool of tools) {
    if (tool.type === 'code_interpreter') {
      result['code_interpreter'] = {
        type: 'function',
        function: {
          name: 'code_interpreter',
          description: 'Execute Python code to analyze data, create visualizations, compute metrics, and generate files.',
          parameters: { type: 'object', properties: {} },
        },
      }
    } else if (tool.type === 'mcp') {
      const label = tool.server_label || 'mcp_tool'
      // Check if it's a KB MCP tool
      if (label.startsWith('kb_')) {
        const stored = getToolDefinitions()
        if (stored[label]) {
          result[label] = stored[label]
        } else {
          result[label] = {
            type: 'function',
            function: {
              name: 'knowledge_base_retrieve',
              description: `Search knowledge base via MCP tool ${label} for relevant documents.`,
              parameters: {
                type: 'object',
                properties: {
                  queries: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Search queries',
                  },
                },
                required: ['queries'],
              },
            },
          }
        }
      } else {
        // External MCP tool (e.g., airport_ops)
        const stored = getToolDefinitions()
        if (stored[label]) {
          result[label] = stored[label]
        } else {
          result[label] = {
            type: 'function',
            function: {
              name: label,
              description: `MCP tool: ${label}`,
              parameters: { type: 'object', properties: {} },
            },
          }
        }
      }
    } else if (tool.type === 'function') {
      result[tool.name || 'function_tool'] = {
        type: 'function',
        function: {
          name: tool.name || 'function_tool',
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {} },
        },
      }
    }
  }

  return result
}
