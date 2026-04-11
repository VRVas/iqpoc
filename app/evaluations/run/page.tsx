'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Play20Regular,
  ArrowLeft20Regular,
  Checkmark20Regular,
  ArrowRight20Regular,
  Database20Regular,
  BrainCircuit20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Run Evaluation Page — supports all 4 evaluation modes per MS Learn:
 *
 * 1. Agent Target: Send queries to agent, evaluate responses
 *    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#agent-target-evaluation
 *
 * 2. Response IDs: Evaluate specific stored response IDs
 *    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#agent-response-evaluation
 *
 * 3. Dataset: Evaluate pre-computed query/response pairs with full fields
 *    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#dataset-evaluation
 *
 * 4. Synthetic: Auto-generate queries + eval  (preview)
 *    Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#synthetic-data-evaluation-preview
 */

type EvalType = 'agent-target' | 'response-ids' | 'dataset' | 'synthetic'

interface ResponseLog {
  response_id: string
  agent_name?: string
  user_query?: string
  timestamp: string
  has_kb_retrieval: boolean
  has_mcp_call: boolean
  tool_count: number
}

export default function RunEvaluationPage() {
  const router = useRouter()
  const [agents, setAgents] = useState<any[]>([])
  const [evaluators, setEvaluators] = useState<any>(null)

  // Form state
  const [evalType, setEvalType] = useState<EvalType>('agent-target')
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedEvaluators, setSelectedEvaluators] = useState<Set<string>>(new Set(['coherence', 'violence', 'task_adherence']))
  const [agentToolTypes, setAgentToolTypes] = useState<Set<string>>(new Set())
  const [agentToolsLoading, setAgentToolsLoading] = useState(false)
  const [agentToolDefinitions, setAgentToolDefinitions] = useState<any[]>([])
  const [queries, setQueries] = useState("refund policy economy ticket\nbaggage allowance business class\npet transport cage sizes dogs\ncan i change my flight to tomorrow\nwhat happens if i miss my connecting flight\nupgrade from economy to business how much\ncheck in online not working\nqmice portal terminated can it be reactivated\nlost luggage compensation process\ndo you fly doha to boston direct\nis QR320 delayed today\nwheelchair assistance how to request\nunaccompanied minor policy age limit\nfrequent flyer miles expire?\nbaggage + pet in cabin same flight possible?\nrefund for cancelled flight AND rebooking options\nlounge access with economy ticket privilege club gold\ninfant bassinet availability long haul\nvisa transit doha do i need one\nboarding gate info doha to london today")
  const [syntheticPrompt, setSyntheticPrompt] = useState("You are simulating a Qatar Airways contact center. Generate realistic customer queries as a contact center operator would type them — short, informal, sometimes grammatically imperfect, using abbreviations. Mix difficulty levels:\n\nEASY (single-topic lookups): baggage limits, check-in times, meal options, seat selection, flight status\nMEDIUM (policy interpretation): refund eligibility, rebooking rules, upgrade costs, loyalty tier benefits, pet transport requirements, unaccompanied minors\nHARD (multi-topic combos): 'refund + rebooking options for cancelled flight', 'pet in cabin AND extra baggage same booking', 'transit visa doha + lounge access with economy ticket', 'upgrade cost business + extra legroom availability'\n\nInclude queries about: baggage, refunds, flight changes, loyalty/Privilege Club, check-in, pet transport, special assistance, MCP airport operations (delays, gates, runway usage), QMICE portal, visa/transit, infant/child policies. Write them as an operator would — not full sentences.")
  const [syntheticCount, setSyntheticCount] = useState(10)

  // Response IDs state
  const [responseLogs, setResponseLogs] = useState<ResponseLog[]>([])
  const [responseLogsLoading, setResponseLogsLoading] = useState(false)
  const [selectedResponseIds, setSelectedResponseIds] = useState<Set<string>>(new Set())

  // Dataset state
  const [datasetRows, setDatasetRows] = useState<string>(
    '{"query": "What is the baggage allowance?", "response": "Economy class passengers are allowed 30kg checked baggage and 7kg hand luggage.", "context": "Baggage policy document: Economy class - 30kg checked, 7kg hand luggage.", "ground_truth": "Economy class passengers can carry 30kg checked and 7kg hand luggage."}\n' +
    '{"query": "How do I request a wheelchair?", "response": "You can request wheelchair assistance through Manage Booking or by calling our contact center 48 hours before departure.", "context": "Special assistance: Wheelchair service available. Request 48h before flight via Manage Booking or contact center.", "ground_truth": "Request wheelchair assistance 48 hours before departure through Manage Booking or contact center."}'
  )

  // Run state
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  // Load agents and evaluators
  useEffect(() => {
    fetch('/api/foundry/agents').then(r => r.json()).then(data => {
      setAgents(data.data || data.agents || data.value || [])
    }).catch(() => {})

    fetch('/api/eval/evaluators').then(r => r.json()).then(setEvaluators).catch(() => {})
  }, [])

  // Load response logs when switching to response-ids mode
  useEffect(() => {
    if (evalType === 'response-ids') {
      setResponseLogsLoading(true)
      fetch('/api/eval/responses/list?limit=100')
        .then(r => r.json())
        .then(data => setResponseLogs(data.responses || []))
        .catch(() => setResponseLogs([]))
        .finally(() => setResponseLogsLoading(false))
    }
  }, [evalType])

  // Fetch agent tool types when agent is selected (for auto-filtering evaluators)
  // Per MS Learn: tool_call_accuracy, tool_input_accuracy, tool_output_utilization,
  // tool_call_success, and groundedness have LIMITED support with Azure AI Search,
  // Code Interpreter, Bing, SharePoint, and Fabric tools.
  // They work well with Function Tool and MCP (knowledge-based MCP excluded).
  // Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#supported-tools
  useEffect(() => {
    if (!selectedAgent) {
      setAgentToolTypes(new Set())
      setAgentToolDefinitions([])
      return
    }
    setAgentToolsLoading(true)
    fetch(`/api/foundry/agents/${encodeURIComponent(selectedAgent)}`)
      .then(r => r.json())
      .then(data => {
        const tools = data?.definition?.tools || data?.versions?.latest?.definition?.tools || []
        const types = new Set<string>()
        const toolDefs: any[] = []
        for (const tool of tools) {
          const t = tool.type || ''
          types.add(t)
          // Generate tool_definitions in OpenAI function-calling schema
          if (t === 'code_interpreter') {
            toolDefs.push({ type: 'function', function: { name: 'code_interpreter', description: 'Execute Python code to analyze data and create visualizations.', parameters: { type: 'object', properties: {} } } })
          } else if (t === 'mcp') {
            const label = tool.server_label || 'mcp_tool'
            const name = label.startsWith('kb_') ? 'knowledge_base_retrieve' : label
            toolDefs.push({ type: 'function', function: { name, description: `MCP tool: ${label}`, parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] } } })
          } else if (t === 'function') {
            toolDefs.push({ type: 'function', function: { name: tool.name || 'function', description: tool.description || '', parameters: tool.parameters || { type: 'object', properties: {} } } })
          }
        }
        setAgentToolTypes(types)
        setAgentToolDefinitions(toolDefs)
      })
      .catch(() => setAgentToolTypes(new Set()))
      .finally(() => setAgentToolsLoading(false))
  }, [selectedAgent])

  // Determine which evaluators should be disabled based on agent's tool types
  // Per MS Learn "Supported tools" section:
  //   https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#supported-tools
  // FULL support: Function Tool, MCP, Knowledge-based MCP
  // LIMITED support: Azure AI Search (native), Code Interpreter, Bing, SharePoint, Fabric
  const LIMITED_SUPPORT_TOOL_TYPES = new Set(['azure_ai_search', 'code_interpreter', 'bing_grounding', 'bing_custom_search', 'sharepoint_grounding', 'fabric'])
  const TOOL_DEF_EVALUATORS = new Set(['tool_call_accuracy', 'tool_selection', 'tool_input_accuracy', 'tool_output_utilization'])
  const LIMITED_SUPPORT_EVALUATORS = new Set([...Array.from(TOOL_DEF_EVALUATORS), 'tool_call_success', 'groundedness'])

  const hasOnlyLimitedSupportTools = (() => {
    if (agentToolTypes.size === 0) return false
    // MCP tools (including KB MCP) have FULL evaluator support per MS Learn
    const hasMcpTool = agentToolTypes.has('mcp')
    if (hasMcpTool) return false
    // Function tools also have full support
    const hasFunctionTool = agentToolTypes.has('function')
    if (hasFunctionTool) return false
    // If only azure_ai_search, code_interpreter, etc. → limited support
    return true
  })()

  const isEvaluatorDisabledByTools = (shortName: string): string | null => {
    if (evalType !== 'agent-target' && evalType !== 'synthetic') return null
    // tool_call_accuracy, tool_selection, tool_input_accuracy, tool_output_utilization
    // require tool_definitions. If we have them (auto-detected from agent), enable.
    if (TOOL_DEF_EVALUATORS.has(shortName)) {
      if (agentToolDefinitions.length > 0) {
        return null // Enabled — tool definitions available
      }
      return 'Disabled — requires tool_definitions (select an agent to auto-detect)'
    }
    if (!hasOnlyLimitedSupportTools) return null
    if (!LIMITED_SUPPORT_EVALUATORS.has(shortName)) return null
    const toolList = Array.from(agentToolTypes).join(', ')
    return `Disabled — limited support with ${toolList} tools`
  }

  const toggleEvaluator = (name: string) => {
    setSelectedEvaluators(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleResponseId = (id: string) => {
    setSelectedResponseIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Map eval type to the mode string used in evaluator compatibility
  const getModeForType = (type: EvalType): string => {
    switch (type) {
      case 'agent-target': return 'agent_target'
      case 'synthetic': return 'synthetic'
      case 'response-ids': return 'response_ids'
      case 'dataset': return 'dataset'
    }
  }

  const handleRun = async () => {
    setRunning(true)
    setError('')
    setResult(null)

    try {
      let endpoint = ''
      let payload: any = {}

      if (evalType === 'agent-target') {
        endpoint = '/evaluate/agent-target'
        payload = {
          name: `Agent eval - ${new Date().toISOString().slice(0, 16)}`,
          agent_name: selectedAgent,
          queries: queries.split('\n').filter(q => q.trim()).map(q => ({ query: q.trim() })),
          evaluators: Array.from(selectedEvaluators),
          tool_definitions: agentToolDefinitions.length > 0 ? agentToolDefinitions : undefined,
        }
      } else if (evalType === 'response-ids') {
        endpoint = '/evaluate/by-response-ids'
        payload = {
          name: `Response ID eval - ${new Date().toISOString().slice(0, 16)}`,
          response_ids: Array.from(selectedResponseIds),
          evaluators: Array.from(selectedEvaluators),
          tool_definitions: agentToolDefinitions.length > 0 ? agentToolDefinitions : undefined,
        }
      } else if (evalType === 'dataset') {
        endpoint = '/evaluate/batch'
        const items = datasetRows
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try { return JSON.parse(line) }
            catch { return null }
          })
          .filter(Boolean)

        if (items.length === 0) {
          setError('No valid JSONL rows found. Each line must be valid JSON.')
          setRunning(false)
          return
        }

        // Inject tool_definitions into each dataset item if tool evaluators are selected
        const enrichedItems = agentToolDefinitions.length > 0
          ? items.map((item: any) => ({ ...item, tool_definitions: JSON.stringify(agentToolDefinitions) }))
          : items

        payload = {
          name: `Dataset eval - ${new Date().toISOString().slice(0, 16)}`,
          evaluators: Array.from(selectedEvaluators),
          data_source: {
            type: 'inline',
            items: enrichedItems,
          },
        }
      } else if (evalType === 'synthetic') {
        endpoint = '/evaluate/synthetic'
        payload = {
          name: `Synthetic eval - ${new Date().toISOString().slice(0, 16)}`,
          agent_name: selectedAgent,
          prompt: syntheticPrompt,
          samples_count: syntheticCount,
          evaluators: Array.from(selectedEvaluators),
          tool_definitions: agentToolDefinitions.length > 0 ? agentToolDefinitions : undefined,
        }
      }

      const response = await fetch('/api/eval/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Evaluation failed')

      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  // Determine if the run button should be enabled
  const canRun = (() => {
    if (running || selectedEvaluators.size === 0) return false
    if (evalType === 'agent-target' && !selectedAgent) return false
    if (evalType === 'response-ids' && selectedResponseIds.size === 0) return false
    if (evalType === 'dataset' && !datasetRows.trim()) return false
    if (evalType === 'synthetic' && !selectedAgent) return false
    return true
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Run Evaluation"
          description="Select evaluation type, choose evaluators, and trigger a run"
        />
        <Button variant="ghost" size="sm" onClick={() => router.push('/evaluations?edit=admin')}>
          <ArrowLeft20Regular className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      {/* Evaluation Type */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-3">Evaluation Type</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {([
            { value: 'agent-target' as EvalType, label: 'Agent Target', desc: 'Send queries to agent, eval responses', icon: '🎯', disabled: false },
            { value: 'response-ids' as EvalType, label: 'Response IDs', desc: 'Under construction — response storage not yet connected', icon: '📋', disabled: true },
            { value: 'dataset' as EvalType, label: 'Dataset', desc: 'Eval pre-computed query/response pairs', icon: '📊', disabled: false },
            { value: 'synthetic' as EvalType, label: 'Synthetic', desc: 'Auto-generate queries + eval (preview)', icon: '🧪', disabled: false },
          ]).map(t => (
            <button
              key={t.value}
              onClick={() => !t.disabled && setEvalType(t.value)}
              disabled={t.disabled}
              className={cn(
                'rounded-xl border p-4 text-left transition-all',
                t.disabled
                  ? 'border-stroke-card opacity-40 cursor-not-allowed'
                  : evalType === t.value
                    ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                    : 'border-stroke-card hover:border-stroke-accent'
              )}
            >
              <span className="text-lg">{t.icon}</span>
              <span className="text-sm font-medium text-fg-default block mt-1">{t.label}</span>
              <p className="text-[10px] text-fg-muted mt-0.5 leading-relaxed">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Agent Selection (for agent-target and synthetic) */}
      {(evalType === 'agent-target' || evalType === 'synthetic') && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
          <h3 className="text-sm font-semibold text-fg-default mb-3">Agent</h3>
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
            className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
          >
            <option value="">Select an agent...</option>
            {agents.map((a: any) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
          {/* Agent Tool Detection Banner */}
          {agentToolsLoading && (
            <p className="text-xs text-fg-muted mt-2 animate-pulse">Detecting agent tools...</p>
          )}
          {!agentToolsLoading && selectedAgent && agentToolTypes.size > 0 && (
            <div className={cn(
              'mt-3 rounded-xl border p-3 text-xs',
              hasOnlyLimitedSupportTools
                ? 'border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800 text-orange-700 dark:text-orange-300'
                : 'border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 text-green-700 dark:text-green-300'
            )}>
              <strong>Agent tools detected:</strong> {Array.from(agentToolTypes).join(', ')}
              {hasOnlyLimitedSupportTools ? (
                <span>. Some evaluators have been auto-disabled because this agent only uses tools with <a href="https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#supported-tools" target="_blank" className="underline">limited evaluator support</a>.</span>
              ) : (
                <span>. This agent uses MCP/Function tools &mdash; all evaluators are available (<a href="https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/agent-evaluators#supported-tools" target="_blank" className="underline">full support</a>).</span>
              )}
              {agentToolDefinitions.length > 0 && (
                <div className="mt-1 text-green-600 dark:text-green-400">
                  ✓ <strong>{agentToolDefinitions.length} tool definition{agentToolDefinitions.length !== 1 ? 's' : ''}</strong> auto-detected &mdash; tool evaluators (tool_call_accuracy, tool_selection, etc.) are enabled.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Response IDs Selection */}
      {evalType === 'response-ids' && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg-default">
              Select Response IDs <span className="text-fg-muted font-normal">({selectedResponseIds.size} selected)</span>
            </h3>
            <button
              onClick={() => {
                if (selectedResponseIds.size === responseLogs.length) {
                  setSelectedResponseIds(new Set())
                } else {
                  setSelectedResponseIds(new Set(responseLogs.map(r => r.response_id)))
                }
              }}
              className="text-xs text-accent hover:underline font-medium"
            >
              {selectedResponseIds.size === responseLogs.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {responseLogsLoading ? (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-12 bg-bg-secondary rounded-lg" />)}
            </div>
          ) : responseLogs.length === 0 ? (
            <div className="text-center py-8 text-sm text-fg-muted">
              <Database20Regular className="h-8 w-8 mx-auto mb-2 text-fg-subtle" />
              <p>No response logs found.</p>
              <p className="text-xs mt-1">Chat with your agent to generate response IDs for evaluation.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {responseLogs.map((log) => (
                <button
                  key={log.response_id}
                  onClick={() => toggleResponseId(log.response_id)}
                  className={cn(
                    'w-full rounded-xl border px-4 py-3 text-left transition-all flex items-start gap-3',
                    selectedResponseIds.has(log.response_id)
                      ? 'border-accent bg-accent/10'
                      : 'border-stroke-card hover:border-stroke-accent'
                  )}
                >
                  <div className={cn(
                    'h-4 w-4 rounded-sm border flex items-center justify-center flex-shrink-0 mt-0.5',
                    selectedResponseIds.has(log.response_id) ? 'bg-accent border-accent' : 'border-stroke-card'
                  )}>
                    {selectedResponseIds.has(log.response_id) && <Checkmark20Regular className="h-3 w-3 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-fg-muted truncate">{log.response_id.slice(0, 24)}...</span>
                      <span className="text-[10px] text-fg-subtle">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    {log.user_query && (
                      <p className="text-xs text-fg-default mt-0.5 truncate">{log.user_query}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      {log.agent_name && <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary text-fg-muted">{log.agent_name}</span>}
                      {log.has_kb_retrieval && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">KB</span>}
                      {log.has_mcp_call && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">MCP</span>}
                      {log.tool_count > 0 && <span className="text-[10px] text-fg-subtle">{log.tool_count} tools</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Evaluators */}
      {evaluators && (() => {
        const currentMode = getModeForType(evalType)
        const isCompatible = (e: any) => !e.red_team_only && e.modes && e.modes.includes(currentMode)
        const compatibleNames = evaluators.built_in?.filter(isCompatible).map((e: any) => e.short_name) || []
        return (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg-default">
              Evaluators <span className="text-fg-muted font-normal">({selectedEvaluators.size} selected / {compatibleNames.length} available for {evalType})</span>
            </h3>
            <button
              onClick={() => {
                if (selectedEvaluators.size === compatibleNames.length) {
                  setSelectedEvaluators(new Set())
                } else {
                  setSelectedEvaluators(new Set(compatibleNames))
                }
              }}
              className="text-xs text-accent hover:underline font-medium"
            >
              {selectedEvaluators.size === compatibleNames.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="space-y-4">
            {['quality', 'rag', 'safety', 'agent', 'similarity'].map(category => {
              const categoryItems = evaluators.built_in?.filter((e: any) => e.category === category) || []
              if (categoryItems.length === 0) return null
              const labels: Record<string, string> = { quality: 'Quality', rag: 'RAG', safety: 'Safety', agent: 'Agent', similarity: 'Similarity' }
              const colors: Record<string, string> = {
                quality: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
                rag: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                safety: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                agent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                similarity: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
              }
              return (
                <div key={category}>
                  <span className={cn('text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full', colors[category] || '')}>{labels[category]}</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                    {categoryItems.map((e: any) => {
                      const isRedTeamOnly = e.red_team_only === true
                      const isIncompatible = !isRedTeamOnly && e.modes && !e.modes.includes(currentMode)
                      const toolDisableReason = isEvaluatorDisabledByTools(e.short_name)
                      const isDisabled = isRedTeamOnly || isIncompatible || !!toolDisableReason
                      // Auto-deselect evaluators that become disabled by tool detection
                      if (toolDisableReason && selectedEvaluators.has(e.short_name)) {
                        // Schedule deselection to avoid state update during render
                        setTimeout(() => setSelectedEvaluators(prev => {
                          const next = new Set(prev)
                          next.delete(e.short_name)
                          return next
                        }), 0)
                      }
                      return (
                      <button
                        key={e.short_name}
                        onClick={() => !isDisabled && toggleEvaluator(e.short_name)}
                        disabled={isDisabled}
                        className={cn(
                          'rounded-xl border px-3 py-2.5 text-left transition-all flex items-start gap-2.5 group',
                          isDisabled
                            ? 'border-stroke-card opacity-40 cursor-not-allowed'
                            : selectedEvaluators.has(e.short_name)
                              ? 'border-accent bg-accent/10'
                              : 'border-stroke-card hover:border-stroke-accent'
                        )}
                      >
                        <div className={cn(
                          'h-4 w-4 rounded-sm border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                          isDisabled ? 'border-stroke-card bg-bg-secondary' :
                          selectedEvaluators.has(e.short_name) ? 'bg-accent border-accent' : 'border-stroke-card'
                        )}>
                          {selectedEvaluators.has(e.short_name) && <Checkmark20Regular className="h-3 w-3 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-fg-default truncate">{e.short_name}</span>
                            {e.requires_model && <BrainCircuit20Regular className="h-3 w-3 text-fg-subtle flex-shrink-0" />}
                            {e.caveat && (
                              <span className="relative group/tip flex-shrink-0">
                                <span className="text-[10px] text-amber-500 cursor-help">⚠</span>
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/tip:block w-56 p-2 text-[10px] text-fg-default bg-bg-card border border-stroke-divider rounded-lg shadow-xl z-50 leading-relaxed">
                                  {e.caveat}
                                </span>
                              </span>
                            )}
                          </div>
                          {e.description && (
                            <p className="text-[10px] text-fg-muted leading-relaxed mt-0.5 line-clamp-2">{e.description}</p>
                          )}
                          {isRedTeamOnly && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300 mt-0.5 inline-block">Red Team only</span>
                          )}
                          {isIncompatible && !isRedTeamOnly && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300 mt-0.5 inline-block">Not for {evalType}</span>
                          )}
                          {toolDisableReason && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300 mt-0.5 inline-block">{toolDisableReason}</span>
                          )}
                        </div>
                      </button>
                    )})}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        )
      })()}

      {/* Test Queries (for agent-target) */}
      {evalType === 'agent-target' && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
          <h3 className="text-sm font-semibold text-fg-default mb-3">Test Queries (one per line)</h3>
          <textarea
            value={queries}
            onChange={e => setQueries(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-3 text-sm text-fg-default font-mono resize-y"
          />
          <p className="text-xs text-fg-muted mt-1">{queries.split('\n').filter(q => q.trim()).length} queries</p>
        </div>
      )}

      {/* Dataset JSONL Editor */}
      {evalType === 'dataset' && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg-default">Dataset (JSONL format, one JSON object per line)</h3>
            <span className="text-[10px] text-fg-muted">Fields: query, response, context, ground_truth</span>
          </div>
          <textarea
            value={datasetRows}
            onChange={e => setDatasetRows(e.target.value)}
            rows={8}
            className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-3 text-xs text-fg-default font-mono resize-y leading-relaxed"
            placeholder='{"query": "...", "response": "...", "context": "...", "ground_truth": "..."}'
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-fg-muted">
              {datasetRows.split('\n').filter(line => { try { JSON.parse(line.trim()); return true } catch { return false } }).length} valid rows
            </p>
            <p className="text-[10px] text-fg-subtle">
              Tip: Include context for groundedness/retrieval evaluators. Include ground_truth for f1_score/response_completeness.
            </p>
          </div>
        </div>
      )}

      {/* Synthetic Config */}
      {evalType === 'synthetic' && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg-default mb-2">Generation Prompt</h3>
            <textarea
              value={syntheticPrompt}
              onChange={e => setSyntheticPrompt(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-3 text-sm text-fg-default resize-y"
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-fg-default mb-2">Number of Queries</h3>
            <input
              type="number"
              value={syntheticCount}
              onChange={e => setSyntheticCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 10)))}
              className="w-32 rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default"
            />
          </div>
        </div>
      )}

      {/* Tool Definitions — shown for response-IDs and dataset when tool evaluators selected */}
      {(evalType === 'response-ids' || evalType === 'dataset') && (() => {
        const hasToolEvaluator = Array.from(selectedEvaluators).some(e => TOOL_DEF_EVALUATORS.has(e))
        if (!hasToolEvaluator) return null
        return (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg-default">
              Tool Definitions <span className="text-fg-muted font-normal">(required for selected evaluators)</span>
            </h3>
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              Per MS Learn: tool_call_accuracy, tool_selection etc. require tool_definitions
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            Select the tools that were available to the agent when these responses were generated. 
            Tool definitions are loaded from your app&apos;s tool store.
          </p>
          <div className="space-y-2">
            {Object.entries((() => {
              try { return JSON.parse(localStorage.getItem('foundry-iq-tool-definitions') || '{}') } catch { return {} }
            })()).map(([key, def]: [string, any]) => (
              <label key={key} className="flex items-start gap-2 text-xs p-2 bg-bg-card rounded-lg border border-stroke-card cursor-pointer hover:border-accent">
                <input
                  type="checkbox"
                  checked={agentToolDefinitions.some((d: any) => d.function?.name === def?.function?.name)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAgentToolDefinitions(prev => [...prev, def])
                    } else {
                      setAgentToolDefinitions(prev => prev.filter((d: any) => d.function?.name !== def?.function?.name))
                    }
                  }}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-fg-default">{key}</div>
                  <div className="text-[10px] text-fg-muted truncate">{def?.function?.description?.slice(0, 120)}</div>
                </div>
              </label>
            ))}
          </div>
          {agentToolDefinitions.length > 0 && (
            <div className="text-xs text-green-600 dark:text-green-400">
              ✓ {agentToolDefinitions.length} tool definition{agentToolDefinitions.length !== 1 ? 's' : ''} selected
            </div>
          )}
        </div>
        )
      })()}

      {/* Run Button */}
      <div className="flex items-center gap-4">
        <Button
          size="lg"
          className="h-12 px-8 bg-accent hover:bg-accent-hover text-fg-on-accent"
          disabled={!canRun}
          onClick={handleRun}
        >
          {running ? (
            <>Running...</>
          ) : (
            <><Play20Regular className="h-5 w-5 mr-2" /> Run Evaluation</>
          )}
        </Button>
        {running && <p className="text-sm text-fg-muted animate-pulse">This may take 1-2 minutes...</p>}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-2xl border border-green-300 bg-green-50 dark:bg-green-900/20 p-6 space-y-3">
          <h3 className="text-sm font-semibold text-green-800 dark:text-green-300">Evaluation Started</h3>
          <div className="text-sm text-green-700 dark:text-green-400 space-y-1">
            <p><strong>Eval ID:</strong> {result.eval_id}</p>
            <p><strong>Run ID:</strong> {result.run_id}</p>
            <p><strong>Status:</strong> {result.status}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/evaluations/results/${result.run_id}?eval_id=${result.eval_id}&edit=admin`)}
          >
            View Results <ArrowRight20Regular className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
