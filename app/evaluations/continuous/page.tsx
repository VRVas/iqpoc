'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft20Regular,
  Checkmark20Regular,
  Play20Regular,
  Pause20Regular,
  ArrowClockwise20Regular,
  BrainCircuit20Regular,
  CalendarClock20Regular,
  Delete20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Continuous & Scheduled Evaluation Page
 *
 * Two tabs:
 * 1. Evaluation Rules — event-driven (RESPONSE_COMPLETED) continuous eval rules
 * 2. Scheduled Evaluations — time-driven recurring eval schedules (daily/weekly)
 */

interface Agent {
  name: string
  [key: string]: any
}

interface Rule {
  id: string
  display_name: string
  description?: string
  enabled: boolean
  event_type: string
  agent_name?: string
  eval_id?: string
  max_hourly_runs?: number
}

interface Schedule {
  schedule_id: string
  display_name: string
  enabled: boolean
}

interface ScheduleRun {
  id: string
  status: string
  created_at: string | null
}

interface Evaluator {
  short_name: string
  name: string
  category: string
  requires_model: boolean
  description: string
  caveat: string | null
  red_team_only: boolean
  modes: string[]
}

export default function ContinuousEvaluationPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'rules' | 'scheduled'>('rules')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Continuous & Scheduled Evaluation"
          description="Automated evaluation rules and recurring schedules for production agents"
        />
        <Button variant="ghost" size="sm" onClick={() => router.push('/evaluations?edit=admin')}>
          <ArrowLeft20Regular className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 rounded-xl bg-bg-secondary p-1 w-fit">
        <button
          onClick={() => setActiveTab('rules')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'rules'
              ? 'bg-bg-card text-fg-default shadow-sm'
              : 'text-fg-muted hover:text-fg-default'
          )}
        >
          <ArrowClockwise20Regular className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          Evaluation Rules
        </button>
        <button
          onClick={() => setActiveTab('scheduled')}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-all',
            activeTab === 'scheduled'
              ? 'bg-bg-card text-fg-default shadow-sm'
              : 'text-fg-muted hover:text-fg-default'
          )}
        >
          <CalendarClock20Regular className="h-4 w-4 inline mr-1.5 -mt-0.5" />
          Scheduled Evaluations
        </button>
      </div>

      {activeTab === 'rules' ? <EvaluationRulesTab /> : <ScheduledEvaluationsTab />}
    </div>
  )
}


// =============================================================================
// TAB 1: Evaluation Rules (existing continuous eval content)
// =============================================================================

function EvaluationRulesTab() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [evaluators, setEvaluators] = useState<Evaluator[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [rulesLoading, setRulesLoading] = useState(true)

  const [selectedAgent, setSelectedAgent] = useState('')
  const [ruleId, setRuleId] = useState('')
  const [displayName, setDisplayName] = useState('Continuous Evaluation Rule')
  const [selectedEvaluators, setSelectedEvaluators] = useState<Set<string>>(
    new Set(['violence', 'hate_unfairness', 'self_harm', 'sexual', 'coherence'])
  )
  const [maxHourlyRuns, setMaxHourlyRuns] = useState(100)
  const [enabled, setEnabled] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/foundry/agents')
      .then(r => r.json())
      .then(data => setAgents(data.data || data.agents || data.value || []))
      .catch(() => {})

    fetch('/api/eval/evaluators')
      .then(r => r.json())
      .then(data => {
        const builtIn = (data.built_in || []).filter(
          (e: Evaluator) => !e.red_team_only && e.modes?.includes('response_ids')
        )
        setEvaluators(builtIn)
      })
      .catch(() => {})

    fetchRules()
  }, [])

  const fetchRules = () => {
    setRulesLoading(true)
    fetch('/api/eval/continuous/rules')
      .then(r => r.json())
      .then(data => setRules(data.rules || []))
      .catch(() => setRules([]))
      .finally(() => setRulesLoading(false))
  }

  useEffect(() => {
    if (selectedAgent) {
      const sanitized = selectedAgent.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
      setRuleId(`continuous-eval-${sanitized}`)
    }
  }, [selectedAgent])

  const toggleEvaluator = (name: string) => {
    setSelectedEvaluators(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('/api/eval/continuous/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_id: ruleId,
          display_name: displayName,
          agent_name: selectedAgent,
          evaluators: Array.from(selectedEvaluators),
          max_hourly_runs: maxHourlyRuns,
          enabled,
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Configuration failed')

      setResult(data)
      fetchRules()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const categoryColors: Record<string, string> = {
    quality: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    rag: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    safety: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    agent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    similarity: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }

  return (
    <>
      {/* Info Banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
        <strong>How it works:</strong> Continuous evaluation rules automatically run evaluators on sampled agent responses
        as they complete in production. Results appear in the Foundry portal&apos;s Monitor tab and feed into the Agent Monitoring Dashboard.
        <a
          href="https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#set-up-continuous-evaluation"
          target="_blank"
          className="ml-1 underline"
        >
          Learn more
        </a>
      </div>

      {/* Existing Rules */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-fg-default">Existing Rules</h3>
          <Button variant="ghost" size="sm" onClick={fetchRules} disabled={rulesLoading}>
            <ArrowClockwise20Regular className={cn("h-4 w-4 mr-1", rulesLoading && "animate-spin")} /> Refresh
          </Button>
        </div>

        {rulesLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2].map(i => <div key={i} className="h-10 bg-bg-secondary rounded-lg" />)}
          </div>
        ) : rules.length === 0 ? (
          <p className="text-sm text-fg-muted py-4 text-center">No continuous evaluation rules configured yet.</p>
        ) : (
          <div className="space-y-2">
            {rules.map(rule => (
              <div key={rule.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-stroke-card bg-bg-secondary">
                <div className="flex items-center gap-3">
                  {rule.enabled
                    ? <Play20Regular className="h-4 w-4 text-green-500" />
                    : <Pause20Regular className="h-4 w-4 text-fg-subtle" />
                  }
                  <div>
                    <span className="text-sm font-medium text-fg-default">{rule.display_name || rule.id}</span>
                    {rule.agent_name && <span className="text-xs text-fg-muted ml-2">· {rule.agent_name}</span>}
                    <p className="text-[10px] text-fg-muted">{rule.event_type}{rule.max_hourly_runs ? ` · max ${rule.max_hourly_runs}/hr` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await fetch(`/api/eval/continuous/rules?rule_id=${encodeURIComponent(rule.id)}&enabled=${!rule.enabled}`, { method: 'PATCH' })
                        fetchRules()
                      } catch {}
                    }}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                      rule.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                    )}
                    title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                  >
                    <span className={cn(
                      'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                      rule.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                    )} style={{ transform: rule.enabled ? 'translateX(18px)' : 'translateX(2px)' }} />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Delete this rule?')) return
                      try {
                        await fetch(`/api/eval/continuous/rules?rule_id=${encodeURIComponent(rule.id)}`, { method: 'DELETE' })
                        fetchRules()
                      } catch {}
                    }}
                    className="text-fg-muted hover:text-red-500 transition-colors p-1"
                    title="Delete rule"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Configuration Form */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-fg-default">Create / Update Rule</h3>

        <div>
          <label className="text-xs font-medium text-fg-muted block mb-1.5">Agent</label>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Rule ID</label>
            <input value={ruleId} onChange={e => setRuleId(e.target.value)} className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Display Name</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Max Hourly Runs</label>
            <input type="number" value={maxHourlyRuns} onChange={e => setMaxHourlyRuns(Math.max(1, Math.min(1000, parseInt(e.target.value) || 100)))} className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setEnabled(!enabled)}
            className={cn('relative h-6 w-11 rounded-full transition-colors', enabled ? 'bg-accent' : 'bg-bg-secondary border border-stroke-card')}
          >
            <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', enabled ? 'translate-x-5' : 'translate-x-0.5')} />
          </button>
          <span className="text-sm text-fg-default">{enabled ? 'Enabled' : 'Disabled'}</span>
        </div>

        <EvaluatorPicker
          evaluators={evaluators}
          selectedEvaluators={selectedEvaluators}
          toggleEvaluator={toggleEvaluator}
          setSelectedEvaluators={setSelectedEvaluators}
          categoryColors={categoryColors}
        />
      </div>

      <div className="flex items-center gap-4">
        <Button size="lg" className="h-12 px-8 bg-accent hover:bg-accent-hover text-fg-on-accent" disabled={submitting || !selectedAgent || selectedEvaluators.size === 0 || !ruleId} onClick={handleSubmit}>
          {submitting ? 'Configuring...' : 'Create / Update Rule'}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {result && (
        <div className="rounded-2xl border border-green-300 bg-green-50 dark:bg-green-900/20 p-6 space-y-2">
          <h3 className="text-sm font-semibold text-green-800 dark:text-green-300">Rule {result.status === 'created' ? 'Created' : 'Updated'}</h3>
          <div className="text-sm text-green-700 dark:text-green-400 space-y-1">
            <p><strong>Rule ID:</strong> {result.rule_id}</p>
            <p><strong>Agent:</strong> {result.agent_name}</p>
            <p><strong>Evaluators:</strong> {result.evaluators?.join(', ')}</p>
            <p><strong>Max Hourly Runs:</strong> {result.max_hourly_runs}</p>
          </div>
          <p className="text-xs text-green-600 dark:text-green-400 mt-2">
            The rule is now active. Evaluation results will appear in the Foundry portal Monitor tab as agent traffic flows.
          </p>
        </div>
      )}
    </>
  )
}


// =============================================================================
// TAB 2: Scheduled Evaluations
// =============================================================================

function ScheduledEvaluationsTab() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [evaluators, setEvaluators] = useState<Evaluator[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null)
  const [scheduleRuns, setScheduleRuns] = useState<Record<string, ScheduleRun[]>>({})
  const [runsLoading, setRunsLoading] = useState<string | null>(null)

  // Create form state
  const [showForm, setShowForm] = useState(false)
  const [scheduleId, setScheduleId] = useState('')
  const [displayName, setDisplayName] = useState('Daily Evaluation')
  const [selectedAgent, setSelectedAgent] = useState('')
  const [selectedEvaluators, setSelectedEvaluators] = useState<Set<string>>(
    new Set(['violence', 'coherence', 'fluency', 'relevance'])
  )
  const [intervalDays, setIntervalDays] = useState(1)
  const [selectedHours, setSelectedHours] = useState<Set<number>>(new Set([9]))
  const [datasetId, setDatasetId] = useState('')
  const [testQueriesJson, setTestQueriesJson] = useState('')
  const [scheduleEnabled, setScheduleEnabled] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    fetch('/api/foundry/agents')
      .then(r => r.json())
      .then(data => setAgents(data.data || data.agents || data.value || []))
      .catch(() => {})

    fetch('/api/eval/evaluators')
      .then(r => r.json())
      .then(data => {
        const builtIn = (data.built_in || []).filter(
          (e: Evaluator) => !e.red_team_only && (e.modes?.includes('dataset') || e.modes?.includes('response_ids'))
        )
        setEvaluators(builtIn)
      })
      .catch(() => {})

    fetchSchedules()
  }, [])

  const fetchSchedules = () => {
    setSchedulesLoading(true)
    fetch('/api/eval/scheduled?action=list')
      .then(r => r.json())
      .then(data => setSchedules(data.schedules || []))
      .catch(() => setSchedules([]))
      .finally(() => setSchedulesLoading(false))
  }

  const fetchScheduleRuns = async (sid: string) => {
    setRunsLoading(sid)
    try {
      const resp = await fetch(`/api/eval/scheduled?action=runs&schedule_id=${encodeURIComponent(sid)}`)
      const data = await resp.json()
      setScheduleRuns(prev => ({ ...prev, [sid]: data.runs || [] }))
    } catch {
      setScheduleRuns(prev => ({ ...prev, [sid]: [] }))
    } finally {
      setRunsLoading(null)
    }
  }

  const toggleExpand = (sid: string) => {
    if (expandedSchedule === sid) {
      setExpandedSchedule(null)
    } else {
      setExpandedSchedule(sid)
      if (!scheduleRuns[sid]) fetchScheduleRuns(sid)
    }
  }

  const deleteSchedule = async (sid: string) => {
    if (!confirm(`Delete schedule "${sid}"?`)) return
    try {
      await fetch('/api/eval/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', schedule_id: sid }),
      })
      fetchSchedules()
    } catch {}
  }

  useEffect(() => {
    if (selectedAgent) {
      const sanitized = selectedAgent.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
      setScheduleId(`sched-${sanitized}-daily`)
    }
  }, [selectedAgent])

  const toggleHour = (h: number) => {
    setSelectedHours(prev => {
      const next = new Set(prev)
      if (next.has(h)) { if (next.size > 1) next.delete(h) }
      else next.add(h)
      return next
    })
  }

  const handleCreateSchedule = async () => {
    setSubmitting(true)
    setError('')
    setSuccessMsg('')

    let testQueries: any[] | undefined
    if (testQueriesJson.trim()) {
      try {
        testQueries = JSON.parse(testQueriesJson)
        if (!Array.isArray(testQueries)) throw new Error('Must be an array')
      } catch (e: any) {
        setError(`Invalid JSON for test queries: ${e.message}`)
        setSubmitting(false)
        return
      }
    }

    if (!datasetId && !testQueries) {
      setError('Provide either a dataset ID or inline test queries')
      setSubmitting(false)
      return
    }

    try {
      const resp = await fetch('/api/eval/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          schedule_id: scheduleId,
          display_name: displayName,
          agent_name: selectedAgent,
          evaluators: Array.from(selectedEvaluators),
          interval_days: intervalDays,
          hours: Array.from(selectedHours).sort(),
          enabled: scheduleEnabled,
          ...(datasetId ? { dataset_id: datasetId } : {}),
          ...(testQueries ? { test_queries: testQueries } : {}),
        }),
      })

      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || data.detail || 'Failed to create schedule')

      setSuccessMsg(`Schedule "${data.schedule_id}" created with eval ${data.eval_id}`)
      setShowForm(false)
      fetchSchedules()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const categoryColors: Record<string, string> = {
    quality: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    rag: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    safety: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    agent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    similarity: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }

  const intervalLabels: Record<number, string> = { 1: 'Daily', 7: 'Weekly', 14: 'Bi-weekly', 30: 'Monthly' }

  return (
    <>
      {/* Info Banner */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-800 p-4 text-sm text-indigo-700 dark:text-indigo-300">
        <strong>How it works:</strong> Scheduled evaluations run evaluators against a test dataset on a recurring schedule (e.g., daily at 9 AM UTC).
        Use them to validate performance against benchmarks over time.
        <a
          href="https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#configure-settings"
          target="_blank"
          className="ml-1 underline"
        >
          Learn more
        </a>
      </div>

      {/* Existing Schedules */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-fg-default">Existing Schedules</h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchSchedules} disabled={schedulesLoading}>
              <ArrowClockwise20Regular className={cn("h-4 w-4 mr-1", schedulesLoading && "animate-spin")} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancel' : '+ New Schedule'}
            </Button>
          </div>
        </div>

        {schedulesLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2].map(i => <div key={i} className="h-12 bg-bg-secondary rounded-lg" />)}
          </div>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-fg-muted py-4 text-center">No scheduled evaluations configured yet.</p>
        ) : (
          <div className="space-y-2">
            {schedules.map(sched => (
              <div key={sched.schedule_id} className="rounded-xl border border-stroke-card bg-bg-secondary overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <button className="flex items-center gap-3 text-left flex-1" onClick={() => toggleExpand(sched.schedule_id)}>
                    <CalendarClock20Regular className="h-4 w-4 text-indigo-500" />
                    <div>
                      <span className="text-sm font-medium text-fg-default">{sched.display_name || sched.schedule_id}</span>
                      <p className="text-[10px] text-fg-muted font-mono">{sched.schedule_id}</p>
                    </div>
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full font-medium',
                      sched.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    )}>
                      {sched.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteSchedule(sched.schedule_id)}
                    className="text-fg-muted hover:text-red-500 transition-colors p-1 ml-2"
                    title="Delete schedule"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" /></svg>
                  </button>
                </div>

                {/* Expandable Runs */}
                {expandedSchedule === sched.schedule_id && (
                  <div className="border-t border-stroke-card px-4 py-3 bg-bg-primary">
                    <h4 className="text-xs font-semibold text-fg-muted mb-2">Recent Runs</h4>
                    {runsLoading === sched.schedule_id ? (
                      <div className="animate-pulse h-6 bg-bg-secondary rounded" />
                    ) : (scheduleRuns[sched.schedule_id] || []).length === 0 ? (
                      <p className="text-xs text-fg-muted">No runs yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {(scheduleRuns[sched.schedule_id] || []).map((run, i) => (
                          <div key={run.id || i} className="flex items-center justify-between text-xs px-2 py-1 rounded-lg bg-bg-secondary">
                            <span className="font-mono text-fg-muted truncate">{run.id}</span>
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                run.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : run.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                              )}>
                                {run.status}
                              </span>
                              {run.created_at && <span className="text-fg-subtle">{new Date(run.created_at).toLocaleString()}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Schedule Form */}
      {showForm && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 space-y-5">
          <h3 className="text-sm font-semibold text-fg-default">Create Schedule</h3>

          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Agent</label>
            <select
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default appearance-none"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
            >
              <option value="">Select an agent...</option>
              {agents.map((a: any) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1.5">Schedule ID</label>
              <input value={scheduleId} onChange={e => setScheduleId(e.target.value)} className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1.5">Display Name</label>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default" />
            </div>
          </div>

          {/* Frequency */}
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Frequency</label>
            <div className="flex gap-2">
              {[1, 7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setIntervalDays(d)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                    intervalDays === d ? 'border-accent bg-accent/10 text-accent' : 'border-stroke-card text-fg-muted hover:border-accent/50'
                  )}
                >
                  {intervalLabels[d]}
                </button>
              ))}
            </div>
          </div>

          {/* Time of day (UTC) */}
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Run at (UTC hours)</label>
            <div className="flex gap-1.5 flex-wrap">
              {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
                <button
                  key={h}
                  onClick={() => toggleHour(h)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-mono border transition-all',
                    selectedHours.has(h) ? 'border-accent bg-accent/10 text-accent' : 'border-stroke-card text-fg-muted hover:border-accent/50'
                  )}
                >
                  {String(h).padStart(2, '0')}:00
                </button>
              ))}
            </div>
          </div>

          {/* Data Source */}
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Data Source</label>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-fg-subtle block mb-1">Dataset file ID (from Foundry)</label>
                <input
                  value={datasetId}
                  onChange={e => setDatasetId(e.target.value)}
                  placeholder="file-abc123..."
                  className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono"
                />
              </div>
              <div className="text-center text-[10px] text-fg-subtle">— or —</div>
              <div>
                <label className="text-[11px] text-fg-subtle block mb-1">Inline test queries (JSON array)</label>
                <textarea
                  value={testQueriesJson}
                  onChange={e => setTestQueriesJson(e.target.value)}
                  placeholder={`[{"query": "What is the baggage allowance?", "response": "Economy: 30kg checked..."}]`}
                  rows={4}
                  className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono resize-y"
                />
              </div>
            </div>
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setScheduleEnabled(!scheduleEnabled)}
              className={cn('relative h-6 w-11 rounded-full transition-colors', scheduleEnabled ? 'bg-accent' : 'bg-bg-secondary border border-stroke-card')}
            >
              <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', scheduleEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
            <span className="text-sm text-fg-default">{scheduleEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>

          {/* Evaluator Picker */}
          <EvaluatorPicker
            evaluators={evaluators}
            selectedEvaluators={selectedEvaluators}
            toggleEvaluator={(name) => {
              setSelectedEvaluators(prev => {
                const next = new Set(prev)
                if (next.has(name)) next.delete(name)
                else next.add(name)
                return next
              })
            }}
            setSelectedEvaluators={setSelectedEvaluators}
            categoryColors={categoryColors}
          />

          {/* Submit */}
          <div className="flex items-center gap-4">
            <Button
              size="lg"
              className="h-12 px-8 bg-accent hover:bg-accent-hover text-fg-on-accent"
              disabled={submitting || !selectedAgent || selectedEvaluators.size === 0 || !scheduleId || (!datasetId && !testQueriesJson.trim())}
              onClick={handleCreateSchedule}
            >
              {submitting ? 'Creating...' : 'Create Schedule'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-green-300 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300">{successMsg}</div>
      )}
    </>
  )
}


// =============================================================================
// Shared: Evaluator Picker Component
// =============================================================================

function EvaluatorPicker({
  evaluators,
  selectedEvaluators,
  toggleEvaluator,
  setSelectedEvaluators,
  categoryColors,
}: {
  evaluators: Evaluator[]
  selectedEvaluators: Set<string>
  toggleEvaluator: (name: string) => void
  setSelectedEvaluators: (s: Set<string>) => void
  categoryColors: Record<string, string>
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-fg-muted">Evaluators ({selectedEvaluators.size} selected)</label>
        <button
          onClick={() => {
            const allNames = evaluators.map(e => e.short_name)
            setSelectedEvaluators(selectedEvaluators.size === allNames.length ? new Set() : new Set(allNames))
          }}
          className="text-xs text-accent hover:underline font-medium"
        >
          {selectedEvaluators.size === evaluators.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>

      <div className="space-y-3">
        {['safety', 'quality', 'rag', 'agent', 'similarity'].map(category => {
          const catEvals = evaluators.filter(e => e.category === category)
          if (catEvals.length === 0) return null
          const labels: Record<string, string> = { quality: 'Quality', rag: 'RAG', safety: 'Safety', agent: 'Agent', similarity: 'Similarity' }
          return (
            <div key={category}>
              <span className={cn('text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full', categoryColors[category] || '')}>
                {labels[category]} ({catEvals.length})
              </span>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-1.5 mt-1.5">
                {catEvals.map(e => (
                  <button
                    key={e.short_name}
                    onClick={() => toggleEvaluator(e.short_name)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left transition-all flex items-center gap-2',
                      selectedEvaluators.has(e.short_name)
                        ? 'border-accent bg-accent/10'
                        : 'border-stroke-card hover:border-stroke-accent'
                    )}
                  >
                    <div className={cn(
                      'h-3.5 w-3.5 rounded-sm border flex items-center justify-center flex-shrink-0',
                      selectedEvaluators.has(e.short_name) ? 'bg-accent border-accent' : 'border-stroke-card'
                    )}>
                      {selectedEvaluators.has(e.short_name) && <Checkmark20Regular className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-xs text-fg-default truncate">{e.short_name}</span>
                      {e.requires_model && <BrainCircuit20Regular className="h-3 w-3 text-fg-subtle flex-shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
