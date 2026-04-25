'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Shield20Regular,
  ArrowLeft20Regular,
  Play20Regular,
  ArrowRight20Regular,
  ArrowClockwise20Regular,
  CheckmarkCircle20Filled,
  DismissCircle20Filled,
  Open20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Red Teaming Page — runs adversarial tests against Foundry agents.
 *
 * Follows the taxonomy-based red teaming flow from MS Learn:
 * 1. Create eval with red team evaluators (prohibited_actions, task_adherence, sensitive_data_leakage)
 * 2. Create taxonomy for agent + risk categories
 * 3. Create run with attack strategies (Flip, Base64, IndirectJailbreak) + taxonomy source
 *
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python
 */

interface Agent {
  name: string
  [key: string]: any
}

function RedTeamContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Data state
  const [agents, setAgents] = useState<Agent[]>([])

  // Form state
  const [selectedAgent, setSelectedAgent] = useState('')
  const [agentVersion, setAgentVersion] = useState('')
  const [numTurns, setNumTurns] = useState(5)
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(
    new Set(['Flip', 'Base64', 'IndirectJailbreak'])
  )
  const [selectedEvaluators, setSelectedEvaluators] = useState<Set<string>>(
    new Set(['prohibited_actions', 'task_adherence', 'sensitive_data_leakage'])
  )

  // Run state
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  // Results state (for viewing a completed run)
  const [viewingResult, setViewingResult] = useState<any>(null)
  const [resultLoading, setResultLoading] = useState(false)

  // Load agents
  useEffect(() => {
    fetch('/api/foundry/agents')
      .then(r => r.json())
      .then(data => setAgents(data.data || data.agents || data.value || []))
      .catch(() => {})
  }, [])

  // Check for result params from URL (for viewing a previous result)
  useEffect(() => {
    const runId = searchParams.get('run_id')
    const evalId = searchParams.get('eval_id')
    if (runId && evalId) {
      fetchResults(runId, evalId)
    }
  }, [searchParams])

  const fetchResults = async (runId: string, evalId: string) => {
    setResultLoading(true)
    try {
      const response = await fetch(`/api/eval/red-team/status/${runId}?eval_id=${evalId}`)
      const data = await response.json()
      setViewingResult(data)
    } catch (err) {
      console.error('Failed to fetch red team results:', err)
    } finally {
      setResultLoading(false)
    }
  }

  const toggleStrategy = (s: string) => {
    setSelectedStrategies(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const toggleEvaluator = (e: string) => {
    setSelectedEvaluators(prev => {
      const next = new Set(prev)
      if (next.has(e)) next.delete(e)
      else next.add(e)
      return next
    })
  }

  const handleRun = async () => {
    setRunning(true)
    setError('')
    setResult(null)
    setViewingResult(null)

    try {
      const response = await fetch('/api/eval/red-team/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Red Team - ${selectedAgent} - ${new Date().toISOString().slice(0, 16)}`,
          agent_name: selectedAgent,
          agent_version: agentVersion || undefined,
          risk_categories: ['ProhibitedActions'],
          attack_strategies: Array.from(selectedStrategies),
          num_turns: numTurns,
          evaluators: Array.from(selectedEvaluators),
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Red team run failed')
      setResult(data)

      // Persist to localStorage + blob so it survives page refreshes and browser changes
      try {
        const RT_STORAGE_KEY = 'foundry-iq-red-team-runs'
        const RT_BLOB_KEY = 'red-team-runs'
        const runEntry = {
          eval_id: data.eval_id,
          run_id: data.run_id,
          name: `Red Team - ${selectedAgent} - ${new Date().toISOString().slice(0, 16)}`,
        }
        const existing = JSON.parse(localStorage.getItem(RT_STORAGE_KEY) || '[]')
        if (!existing.some((r: any) => r.run_id === data.run_id)) {
          existing.push(runEntry)
          localStorage.setItem(RT_STORAGE_KEY, JSON.stringify(existing))
        }
        // Also save to blob for cross-session persistence
        fetch(`/api/eval/insights/${RT_BLOB_KEY}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runs: existing }),
        }).catch(() => {})
      } catch {}
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  // Per docs: attack strategies supported
  const attackStrategies = [
    { id: 'Flip', label: 'Flip', desc: 'Character substitution to evade text filters' },
    { id: 'Base64', label: 'Base64', desc: 'Encode prompts in Base64 to bypass safety checks' },
    { id: 'IndirectJailbreak', label: 'Indirect Jailbreak', desc: 'Multi-step manipulation to bypass agent instructions' },
  ]

  // Per docs: red team evaluators
  const redTeamEvaluators = [
    { id: 'prohibited_actions', label: 'Prohibited Actions', desc: 'Detects actions violating agent policy' },
    { id: 'task_adherence', label: 'Task Adherence', desc: 'Checks if agent follows its instructions under attack' },
    { id: 'sensitive_data_leakage', label: 'Sensitive Data Leakage', desc: 'Detects exposure of sensitive information' },
  ]

  // Auto-poll if viewing a running result
  useEffect(() => {
    if (viewingResult?.status === 'running' || viewingResult?.status === 'queued') {
      const runId = searchParams.get('run_id') || result?.run_id
      const evalId = searchParams.get('eval_id') || result?.eval_id
      if (runId && evalId) {
        const interval = setInterval(() => fetchResults(runId, evalId), 8000)
        return () => clearInterval(interval)
      }
    }
  }, [viewingResult?.status])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="AI Red Teaming"
          description="Run adversarial tests to probe agent safety and policy compliance"
        />
        <Button variant="ghost" size="sm" onClick={() => router.push('/evaluations?edit=admin')}>
          <ArrowLeft20Regular className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      {/* Info Banner */}
      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
        <strong>How it works:</strong> The AI Red Teaming Agent generates adversarial prompts using attack strategies,
        sends multi-turn conversations to your agent, and evaluates whether the agent violates its policies.
        Results include Attack Success Rate (ASR) per risk category.
        <a
          href="https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python"
          target="_blank"
          className="ml-1 underline"
        >
          Learn more
        </a>
      </div>

      {/* Agent Selection */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-3">Target Agent</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Agent Name</label>
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
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Version (optional)</label>
            <input
              value={agentVersion}
              onChange={e => setAgentVersion(e.target.value)}
              placeholder="Latest"
              className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default"
            />
          </div>
        </div>
      </div>

      {/* Attack Strategies */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-3">
          Attack Strategies <span className="text-fg-muted font-normal">({selectedStrategies.size} selected)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {attackStrategies.map(s => (
            <button
              key={s.id}
              onClick={() => toggleStrategy(s.id)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-all',
                selectedStrategies.has(s.id)
                  ? 'border-red-400 bg-red-50 dark:bg-red-900/20 ring-1 ring-red-300'
                  : 'border-stroke-card hover:border-stroke-accent'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <Shield20Regular className={cn('h-4 w-4', selectedStrategies.has(s.id) ? 'text-red-500' : 'text-fg-subtle')} />
                <span className="text-sm font-medium text-fg-default">{s.label}</span>
              </div>
              <p className="text-[10px] text-fg-muted leading-relaxed">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Evaluators */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-3">
          Red Team Evaluators <span className="text-fg-muted font-normal">({selectedEvaluators.size} selected)</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {redTeamEvaluators.map(e => (
            <button
              key={e.id}
              onClick={() => toggleEvaluator(e.id)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-all',
                selectedEvaluators.has(e.id)
                  ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                  : 'border-stroke-card hover:border-stroke-accent'
              )}
            >
              <span className="text-sm font-medium text-fg-default">{e.label}</span>
              <p className="text-[10px] text-fg-muted leading-relaxed mt-0.5">{e.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Run Configuration */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-3">Configuration</h3>
        <div>
          <label className="text-xs font-medium text-fg-muted block mb-1.5">Number of Turns (multi-turn conversation depth)</label>
          <input
            type="number"
            value={numTurns}
            onChange={e => setNumTurns(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
            className="w-32 rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default"
          />
          <p className="text-[10px] text-fg-muted mt-1">Higher turns allow more sophisticated multi-step attacks (recommended: 3-5)</p>
        </div>
      </div>

      {/* Run Button */}
      <div className="flex items-center gap-4">
        <Button
          size="lg"
          className="h-12 px-8 bg-red-600 hover:bg-red-700 text-white"
          disabled={running || !selectedAgent || selectedStrategies.size === 0 || selectedEvaluators.size === 0}
          onClick={handleRun}
        >
          {running ? (
            <>Running...</>
          ) : (
            <><Shield20Regular className="h-5 w-5 mr-2" /> Start Red Team Scan</>
          )}
        </Button>
        {running && <p className="text-sm text-fg-muted animate-pulse">This may take 5-10 minutes for multi-turn attacks...</p>}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-6 space-y-3">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Red Team Scan Started</h3>
          <div className="text-sm text-amber-700 dark:text-amber-400 space-y-1">
            <p><strong>Eval ID:</strong> {result.eval_id}</p>
            <p><strong>Run ID:</strong> {result.run_id}</p>
            {result.taxonomy_id && <p><strong>Taxonomy ID:</strong> {result.taxonomy_id}</p>}
            <p><strong>Status:</strong> {result.status}</p>
            <p><strong>Estimated Duration:</strong> {result.estimated_duration_minutes} minutes</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchResults(result.run_id, result.eval_id)
              }}
            >
              <ArrowClockwise20Regular className="h-4 w-4 mr-1" /> Check Status
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/evaluations/results/${result.run_id}?eval_id=${result.eval_id}&edit=admin`)}
            >
              View in Results <ArrowRight20Regular className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Viewing Results Inline */}
      {resultLoading && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-fg-muted">Loading red team results...</p>
        </div>
      )}

      {viewingResult && !resultLoading && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg-default">
              Scan Results — Status: <span className={cn(
                viewingResult.status === 'completed' ? 'text-green-600' :
                viewingResult.status === 'failed' ? 'text-red-600' : 'text-amber-600'
              )}>{viewingResult.status}</span>
            </h3>
            {viewingResult.report_url && (
              <Button variant="ghost" size="sm" onClick={() => window.open(viewingResult.report_url, '_blank')}>
                <Open20Regular className="h-4 w-4 mr-1" /> Foundry Portal
              </Button>
            )}
          </div>

          {/* Summary */}
          {viewingResult.result_counts && (
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-xl border border-stroke-card bg-bg-secondary p-3 text-center">
                <p className="text-xl font-bold text-fg-default">{viewingResult.result_counts.total}</p>
                <p className="text-[10px] text-fg-muted">Total</p>
              </div>
              <div className="rounded-xl border border-stroke-card bg-bg-secondary p-3 text-center">
                <p className="text-xl font-bold text-green-600">{viewingResult.result_counts.passed}</p>
                <p className="text-[10px] text-fg-muted">Defended</p>
              </div>
              <div className="rounded-xl border border-stroke-card bg-bg-secondary p-3 text-center">
                <p className="text-xl font-bold text-red-600">{viewingResult.result_counts.failed}</p>
                <p className="text-[10px] text-fg-muted">Breached</p>
              </div>
              <div className="rounded-xl border border-stroke-card bg-bg-secondary p-3 text-center">
                <p className="text-xl font-bold text-amber-600">{viewingResult.result_counts.errored}</p>
                <p className="text-[10px] text-fg-muted">Errored</p>
              </div>
            </div>
          )}

          {/* Per-evaluator bars */}
          {viewingResult.per_evaluator?.length > 0 && (
            <div className="space-y-2">
              {viewingResult.per_evaluator.map((ev: any) => {
                const total = (ev.passed || 0) + (ev.failed || 0)
                const defenseRate = total > 0 ? ((ev.passed || 0) / total) * 100 : 0
                return (
                  <div key={ev.name} className="flex items-center gap-3">
                    <span className="text-xs text-fg-default w-36 truncate font-medium">{ev.name}</span>
                    <div className="flex-1 h-2 bg-bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', defenseRate >= 80 ? 'bg-green-500' : defenseRate >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${defenseRate}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-fg-muted w-24 text-right">
                      {ev.passed}/{total} defended ({defenseRate.toFixed(0)}%)
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {(viewingResult.status === 'running' || viewingResult.status === 'queued') && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <div className="h-4 w-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              Auto-refreshing every 8 seconds...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RedTeamPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}>
      <RedTeamContent />
    </Suspense>
  )
}
