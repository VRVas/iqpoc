'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft20Regular,
  Search20Regular,
  ArrowRight20Regular,
  ArrowClockwise20Regular,
  CheckmarkCircle20Filled,
  DismissCircle20Filled,
  Shield20Regular,
  DataBarVertical20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Evaluation & Red Teaming Results Page — tabbed interface.
 *
 * Tab 1: Evaluations — recent eval runs (agent-target, dataset, synthetic, response-ids)
 * Tab 2: Red Teaming — red team scan runs with attack success rate (ASR)
 *
 * Both use the same Foundry Evals API under the hood:
 *   client.evals.list() + client.evals.runs.list()
 * Distinguished by the `type` field returned by our history API
 * (detected via eval name pattern: "Red Team" prefix).
 *
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python#list-red-teaming-run-output-items-and-results
 */

type Tab = 'evaluations' | 'red-team'

interface EvalRun {
  id: string
  eval_id: string
  eval_name?: string
  type?: string
  name: string
  status: string
  created_at?: number
  report_url?: string
  result_counts?: {
    total: number
    passed: number
    failed: number
    errored: number
  }
}

export default function ResultsIndexPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('evaluations')
  const [allRuns, setAllRuns] = useState<EvalRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [evalId, setEvalId] = useState('')
  const [runId, setRunId] = useState('')

  // ---------------------------------------------------------------------------
  // Red team run persistence via localStorage
  // Foundry's evals.list() doesn't return red team evals (separate namespace).
  // We store known red team run IDs in localStorage and fetch their status
  // directly from the Foundry API on each load.
  // ---------------------------------------------------------------------------
  const RT_STORAGE_KEY = 'foundry-iq-red-team-runs'

  function getStoredRedTeamRuns(): Array<{eval_id: string; run_id: string; name: string}> {
    try {
      return JSON.parse(localStorage.getItem(RT_STORAGE_KEY) || '[]')
    } catch { return [] }
  }

  function storeRedTeamRun(evalId: string, runId: string, name: string) {
    const existing = getStoredRedTeamRuns()
    if (!existing.some(r => r.run_id === runId)) {
      existing.push({ eval_id: evalId, run_id: runId, name })
      localStorage.setItem(RT_STORAGE_KEY, JSON.stringify(existing))
    }
  }

  const fetchHistory = () => {
    setLoading(true)
    setError('')

    // Fetch eval runs from history API
    const evalPromise = fetch('/api/eval/history?action=recent-runs&limit=50')
      .then(r => r.json())
      .catch(() => ({ runs: [] }))

    // Fetch red team run status for each stored run ID
    const storedRtRuns = getStoredRedTeamRuns()
    const rtPromises = storedRtRuns.map(rt =>
      fetch(`/api/eval/status/${rt.run_id}?eval_id=${rt.eval_id}`)
        .then(r => r.json())
        .then(data => ({
          id: rt.run_id,
          eval_id: rt.eval_id,
          eval_name: rt.name,
          type: 'red_team' as const,
          name: rt.name,
          status: data.status || 'unknown',
          created_at: undefined as number | undefined,
          report_url: data.report_url,
          result_counts: data.result_counts,
        }))
        .catch(() => null)
    )

    Promise.all([evalPromise, ...rtPromises])
      .then(([evalData, ...rtResults]) => {
        if (evalData.error) throw new Error(evalData.error)
        const evalRuns = (evalData.runs || []).map((r: any) => ({ ...r, type: r.type || 'evaluation' }))
        const rtRuns = (rtResults.filter(Boolean) as EvalRun[])
        setAllRuns([...evalRuns, ...rtRuns].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)))
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  // Seed the existing red team run on first mount
  useEffect(() => {
    // Register the known red team run so it persists across refreshes
    storeRedTeamRun(
      'eval_2b986ef7d2ab42c28b1901650f253cec',
      'evalrun_431e6d9084854b899c3ea439d085297c',
      'Red Team - agent-1774946608254 - 2026-04-08T17:46'
    )
    fetchHistory()
  }, [])

  const evalRuns = allRuns.filter(r => r.type !== 'red_team')
  const redTeamRuns = allRuns.filter(r => r.type === 'red_team')
  const currentRuns = tab === 'evaluations' ? evalRuns : redTeamRuns

  const handleLookup = () => {
    if (evalId && runId) {
      router.push(`/evaluations/results/${runId}?eval_id=${evalId}&edit=admin`)
    }
  }

  const statusColor = (status: string) => {
    if (status === 'completed') return 'text-green-600 dark:text-green-400'
    if (status === 'failed') return 'text-red-600 dark:text-red-400'
    return 'text-amber-600 dark:text-amber-400'
  }

  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckmarkCircle20Filled className="h-4 w-4 text-green-500 flex-shrink-0" />
    if (status === 'failed') return <DismissCircle20Filled className="h-4 w-4 text-red-500 flex-shrink-0" />
    return <div className="h-4 w-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Results"
          description="Browse evaluation and red teaming results"
        />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push('/evaluations?edit=admin')}>
            <ArrowLeft20Regular className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button variant="ghost" size="sm" onClick={fetchHistory} disabled={loading}>
            <ArrowClockwise20Regular className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-bg-secondary border border-stroke-divider">
        <button
          onClick={() => setTab('evaluations')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
            tab === 'evaluations'
              ? 'bg-bg-card shadow-sm text-fg-default border border-stroke-card'
              : 'text-fg-muted hover:text-fg-default'
          )}
        >
          <DataBarVertical20Regular className="h-4 w-4" />
          Evaluations
          {!loading && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-secondary text-fg-subtle">{evalRuns.length}</span>}
        </button>
        <button
          onClick={() => setTab('red-team')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
            tab === 'red-team'
              ? 'bg-bg-card shadow-sm text-fg-default border border-stroke-card'
              : 'text-fg-muted hover:text-fg-default'
          )}
        >
          <Shield20Regular className="h-4 w-4" />
          Red Teaming
          {!loading && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-secondary text-fg-subtle">{redTeamRuns.length}</span>}
        </button>
      </div>

      {/* Run List */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-4">
          {tab === 'evaluations' ? 'Recent Evaluation Runs' : 'Recent Red Team Scans'}
        </h3>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 bg-bg-secondary rounded-xl" />)}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : currentRuns.length === 0 ? (
          <div className="text-center py-8">
            {tab === 'evaluations' ? (
              <>
                <DataBarVertical20Regular className="h-8 w-8 mx-auto text-fg-subtle mb-2" />
                <p className="text-sm text-fg-muted">No evaluation runs found.</p>
                <p className="text-xs text-fg-subtle mt-1">Run an evaluation from the Run Evaluation page.</p>
              </>
            ) : (
              <>
                <Shield20Regular className="h-8 w-8 mx-auto text-fg-subtle mb-2" />
                <p className="text-sm text-fg-muted">No red team scans found.</p>
                <p className="text-xs text-fg-subtle mt-1">Start a red team scan from the Red Teaming page.</p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {currentRuns.map(run => {
              const isRedTeam = run.type === 'red_team'
              const passRate = run.result_counts
                ? run.result_counts.total > 0
                  ? ((run.result_counts.passed / run.result_counts.total) * 100).toFixed(0)
                  : '0'
                : null
              const createdDate = run.created_at
                ? new Date(run.created_at * 1000).toLocaleString()
                : ''

              return (
                <button
                  key={`${run.eval_id}-${run.id}`}
                  onClick={() => router.push(`/evaluations/results/${run.id}?eval_id=${run.eval_id}&edit=admin`)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-stroke-card hover:border-stroke-accent bg-bg-secondary/50 hover:bg-bg-secondary transition-all text-left group"
                >
                  {isRedTeam
                    ? <Shield20Regular className={cn("h-4 w-4 flex-shrink-0", run.status === 'completed' ? 'text-green-500' : run.status === 'failed' ? 'text-red-500' : 'text-amber-500')} />
                    : statusIcon(run.status)
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg-default truncate">
                        {run.eval_name || run.name || run.id.slice(0, 20)}
                      </span>
                      {isRedTeam && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300 font-medium">RED TEAM</span>
                      )}
                      <span className={cn('text-[10px] font-medium', statusColor(run.status))}>
                        {run.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {createdDate && <span className="text-[10px] text-fg-subtle">{createdDate}</span>}
                      <span className="text-[10px] text-fg-subtle font-mono">{run.id.slice(0, 16)}...</span>
                    </div>
                  </div>
                  {run.result_counts && (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <span className="text-sm font-bold text-fg-default">{passRate}%</span>
                        <span className="text-[10px] text-fg-muted block">{isRedTeam ? 'defended' : 'pass rate'}</span>
                      </div>
                      <div className="flex gap-1.5 text-[10px]">
                        <span className="text-green-600">{run.result_counts.passed}{isRedTeam ? 'D' : 'P'}</span>
                        <span className="text-red-600">{run.result_counts.failed}{isRedTeam ? 'B' : 'F'}</span>
                        {run.result_counts.errored > 0 && <span className="text-amber-600">{run.result_counts.errored}E</span>}
                      </div>
                    </div>
                  )}
                  <ArrowRight20Regular className="h-4 w-4 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Manual Lookup */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-fg-default">Manual Lookup</h3>
        <p className="text-xs text-fg-muted">Enter specific Eval ID and Run ID to view results directly. Works for both evaluations and red team scans.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Eval ID</label>
            <input
              value={evalId}
              onChange={e => setEvalId(e.target.value.trim())}
              placeholder="eval_..."
              className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1.5">Run ID</label>
            <input
              value={runId}
              onChange={e => setRunId(e.target.value.trim())}
              placeholder="evalrun_..."
              className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono"
            />
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!evalId || !runId}
          onClick={handleLookup}
        >
          <Search20Regular className="h-4 w-4 mr-2" /> View Results
        </Button>
      </div>
    </div>
  )
}
