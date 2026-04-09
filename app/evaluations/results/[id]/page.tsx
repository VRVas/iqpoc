'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft20Regular,
  CheckmarkCircle20Filled,
  DismissCircle20Filled,
  Warning20Filled,
  ArrowClockwise20Regular,
  Open20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Evaluation Results Detail Page — with proper 3-state logic.
 *
 * Per Foundry's result schema, each evaluator result can be:
 * - PASS: passed === true (green)
 * - FAIL: passed === false (red)
 * - ERROR: passed is null/undefined, no score (amber) — evaluator couldn't run
 *
 * The result_counts.errored field counts ITEMS that had at least 1 evaluator error,
 * NOT the total number of individual evaluator errors.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResultStatus = 'pass' | 'fail' | 'error'

function getResultStatus(r: any): ResultStatus {
  if (r.passed === true) return 'pass'
  if (r.passed === false) return 'fail'
  // Only treat score as pass if it's a positive number (score=0 with no passed field is ambiguous)
  if (typeof r.score === 'number' && r.score > 0) return 'pass'
  return 'error'
}

function getItemCounts(results: any[]) {
  let passed = 0, failed = 0, errored = 0
  for (const r of results) {
    const s = getResultStatus(r)
    if (s === 'pass') passed++
    else if (s === 'fail') failed++
    else errored++
  }
  return { passed, failed, errored, total: results.length }
}

function getItemOverallStatus(results: any[]): ResultStatus {
  const counts = getItemCounts(results)
  if (counts.total === 0) return 'error' // no results at all
  if (counts.failed > 0) return 'fail'
  if (counts.errored > 0) return 'error' // amber if ANY evaluator errored, even if others passed
  return 'pass'
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function ResultsContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const runId = params.id as string
  const evalId = searchParams.get('eval_id') || ''

  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const ITEMS_PER_PAGE = 10

  const fetchResults = async () => {
    try {
      setPolling(true)
      const response = await fetch(`/api/eval/status/${runId}?eval_id=${evalId}`)
      const data = await response.json()
      setResult(data)
    } catch (err) {
      console.error('Failed to fetch results:', err)
    } finally {
      setLoading(false)
      setPolling(false)
    }
  }

  useEffect(() => {
    if (runId && evalId) fetchResults()
  }, [runId, evalId])

  useEffect(() => {
    if (result?.status === 'running' || result?.status === 'queued') {
      const interval = setInterval(fetchResults, 5000)
      return () => clearInterval(interval)
    }
  }, [result?.status])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-fg-muted">Loading evaluation results...</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return <div className="text-center py-20 text-fg-muted">No results found</div>
  }

  const isRunning = result.status === 'running' || result.status === 'queued'

  // Compute aggregate error stats from individual items
  const totalEvaluatorErrors = result.items?.reduce((sum: number, item: any) => {
    return sum + (item.results?.filter((r: any) => getResultStatus(r) === 'error').length || 0)
  }, 0) || 0

  // Find which evaluators consistently error (error on every item)
  const evaluatorErrorMap: Record<string, number> = {}
  result.items?.forEach((item: any) => {
    item.results?.forEach((r: any) => {
      const name = r.name || r.metric || 'unknown'
      if (getResultStatus(r) === 'error') {
        evaluatorErrorMap[name] = (evaluatorErrorMap[name] || 0) + 1
      }
    })
  })
  const alwaysErrorEvaluators = Object.entries(evaluatorErrorMap)
    .filter(([, count]) => count >= (result.items?.length || 1))
    .map(([name]) => name)

  // Evaluators that errored on SOME but not all items
  const partialErrorEvaluators = Object.entries(evaluatorErrorMap)
    .filter(([, count]) => count > 0 && count < (result.items?.length || 1))
    .map(([name, count]) => `${name} (${count}/${result.items?.length || 0})`)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Evaluation Results"
          description={`Run: ${runId.slice(0, 20)}... · Status: ${result.status}`}
        />
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push('/evaluations?edit=admin')}>
            <ArrowLeft20Regular className="h-4 w-4 mr-1" /> Back
          </Button>
          {isRunning && (
            <Button variant="ghost" size="sm" onClick={fetchResults} disabled={polling}>
              <ArrowClockwise20Regular className={cn("h-4 w-4 mr-1", polling && "animate-spin")} /> Refresh
            </Button>
          )}
          {result.report_url && (
            <Button variant="ghost" size="sm" onClick={() => window.open(result.report_url, '_blank')}>
              <Open20Regular className="h-4 w-4 mr-1" /> Foundry Portal
            </Button>
          )}
        </div>
      </div>

      {/* Status Banner */}
      {isRunning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300">Evaluation is running... auto-refreshing every 5 seconds.</p>
        </div>
      )}

      {/* Summary Cards */}
      {result.result_counts && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Items Evaluated" value={result.result_counts.total} subtitle="test queries" />
            <SummaryCard label="All Passed" value={result.result_counts.passed} color="green" subtitle="every evaluator passed" />
            <SummaryCard label="Failed" value={result.result_counts.failed} color="red" subtitle="at least 1 evaluator failed" />
            <SummaryCard label="Had Errors" value={result.result_counts.errored} color="amber" subtitle="evaluator(s) couldn't run" />
          </div>

          {/* Error explanation banner */}
          {result.result_counts.errored > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 flex items-start gap-3">
              <Warning20Filled className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-700 dark:text-amber-300">
                <strong>{result.result_counts.errored} of {result.result_counts.total} items</strong> had at least one evaluator that couldn&apos;t run ({totalEvaluatorErrors} individual evaluator errors total).
                {alwaysErrorEvaluators.length > 0 && (
                  <span> Evaluators that errored on every item: <strong>{alwaysErrorEvaluators.join(', ')}</strong>. These likely require <code className="text-xs bg-amber-100 dark:bg-amber-900/40 px-1 rounded">tool_definitions</code> or have limited support with your agent&apos;s tool types (Azure AI Search, MCP).</span>
                )}
                {partialErrorEvaluators.length > 0 && (
                  <span> Evaluators that errored on some items: <strong>{partialErrorEvaluators.join(', ')}</strong>.</span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Per-Evaluator Results */}
      {result.per_evaluator && result.per_evaluator.length > 0 && (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
          <h3 className="text-sm font-semibold text-fg-default mb-4">Per-Evaluator Results</h3>
          <div className="space-y-3">
            {result.per_evaluator.map((ev: any) => {
              const ran = (ev.passed || 0) + (ev.failed || 0)
              // For error count: only compute if we can derive from actual items, not from
              // result_counts.total which is a cross-category aggregate (especially for red team)
              const itemCount = result.items?.length || 0
              const errorCount = itemCount > 0 ? Math.max(0, itemCount - ran) : 0
              const barTotal = ran + errorCount || 1
              const isAllErrored = ran === 0 && itemCount > 0
              const passRate = ran > 0 ? ((ev.passed || 0) / ran) * 100 : 0
              return (
                <div key={ev.name} className="flex items-center gap-4">
                  <span className={cn("text-sm w-44 truncate font-medium", isAllErrored ? "text-fg-subtle line-through" : "text-fg-default")}>{ev.name}</span>
                  <div className="flex-1 h-2.5 bg-bg-secondary rounded-full overflow-hidden flex">
                    {!isAllErrored && (
                      <>
                        <div className="h-full bg-green-500 transition-all" style={{ width: `${(ev.passed / barTotal) * 100}%` }} />
                        <div className="h-full bg-red-500 transition-all" style={{ width: `${((ev.failed || 0) / barTotal) * 100}%` }} />
                      </>
                    )}
                    {errorCount > 0 && (
                      <div className="h-full bg-amber-400 transition-all" style={{ width: `${(errorCount / barTotal) * 100}%` }} />
                    )}
                  </div>
                  <span className="text-xs text-fg-muted w-36 text-right">
                    {isAllErrored ? (
                      <span className="text-amber-600">all errored</span>
                    ) : (
                      <>
                        {ev.passed}/{ran} ({passRate.toFixed(0)}%)
                        {errorCount > 0 && <span className="text-amber-500 ml-1">({errorCount} errored)</span>}
                      </>
                    )}
                  </span>
                </div>
              )
            })}

            {/* Show evaluators that errored on all items but aren't in per_evaluator */}
            {alwaysErrorEvaluators.filter(name => !result.per_evaluator.some((ev: any) => ev.name === name)).map(name => (
              <div key={name} className="flex items-center gap-4">
                <span className="text-sm w-44 truncate font-medium text-fg-subtle line-through">{name}</span>
                <div className="flex-1 h-2.5 bg-amber-200 dark:bg-amber-900/30 rounded-full overflow-hidden" />
                <span className="text-xs text-amber-600 w-36 text-right">all errored</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Individual Items — paginated */}
      {result.items && result.items.length > 0 && (() => {
        const totalPages = Math.ceil(result.items.length / ITEMS_PER_PAGE)
        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE
        const pageItems = result.items.slice(startIdx, startIdx + ITEMS_PER_PAGE)

        return (
        <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-fg-default">
              Individual Results ({result.items.length} items)
            </h3>
            {totalPages > 1 && (
              <span className="text-xs text-fg-muted">
                Page {currentPage} of {totalPages} · Showing {startIdx + 1}-{Math.min(startIdx + ITEMS_PER_PAGE, result.items.length)}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {pageItems.map((item: any, pidx: number) => {
              const idx = startIdx + pidx
              const counts = getItemCounts(item.results || [])
              const overallStatus = getItemOverallStatus(item.results || [])
              const isExpanded = expandedItem === item.id
              const query = item.datasource_item?.query || `Item ${idx + 1}`

              return (
                <div key={item.id || idx} className="border border-stroke-card rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-secondary/50 transition-colors"
                  >
                    {overallStatus === 'pass' && <CheckmarkCircle20Filled className="h-5 w-5 text-green-500 flex-shrink-0" />}
                    {overallStatus === 'fail' && <DismissCircle20Filled className="h-5 w-5 text-red-500 flex-shrink-0" />}
                    {overallStatus === 'error' && <Warning20Filled className="h-5 w-5 text-amber-500 flex-shrink-0" />}
                    <span className="text-sm text-fg-default truncate flex-1">{typeof query === 'string' ? query.slice(0, 100) : `Item ${idx + 1}`}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-green-600">{counts.passed}P</span>
                      {counts.failed > 0 && <span className="text-xs text-red-600">{counts.failed}F</span>}
                      {counts.errored > 0 && <span className="text-xs text-amber-500">{counts.errored}E</span>}
                      <span className="text-[10px] text-fg-subtle">/ {counts.total}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-stroke-card px-4 py-4 bg-bg-secondary/30 space-y-4">
                      {item.datasource_item?.query && (
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">Query</span>
                          <p className="text-sm text-fg-default mt-1">{typeof item.datasource_item.query === 'string' ? item.datasource_item.query : JSON.stringify(item.datasource_item.query).slice(0, 300)}</p>
                        </div>
                      )}
                      {(item.datasource_item?.response || item.datasource_item?.['sample.output_text']) && (
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">Response</span>
                          <p className="text-sm text-fg-muted mt-1 whitespace-pre-wrap">
                            {(item.datasource_item.response || item.datasource_item['sample.output_text'] || '').toString().slice(0, 500)}
                          </p>
                        </div>
                      )}

                      {/* Evaluator Scores — 3-state */}
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">Evaluator Scores</span>
                        <div className="space-y-2 mt-2">
                          {item.results?.map((r: any, ridx: number) => {
                            const status = getResultStatus(r)
                            return (
                              <div key={ridx} className={cn(
                                "flex items-start gap-3 p-3 rounded-lg border",
                                status === 'pass' ? 'bg-bg-card border-stroke-card' :
                                status === 'fail' ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800' :
                                'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                              )}>
                                {status === 'pass' && <CheckmarkCircle20Filled className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />}
                                {status === 'fail' && <DismissCircle20Filled className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />}
                                {status === 'error' && <Warning20Filled className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-semibold text-fg-default">{r.name || r.metric}</span>
                                    {r.score !== undefined && r.score !== null && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-secondary text-fg-muted">
                                        Score: {typeof r.score === 'number' ? r.score.toFixed(1) : r.score}
                                      </span>
                                    )}
                                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium',
                                      status === 'pass' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                                      status === 'fail' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                                      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    )}>
                                      {status === 'pass' ? (r.label || 'PASS') : status === 'fail' ? (r.label || 'FAIL') : 'ERROR'}
                                    </span>
                                  </div>
                                  {r.reason && (
                                    <p className="text-xs text-fg-muted mt-1 leading-relaxed">{r.reason}</p>
                                  )}
                                  {status === 'error' && !r.reason && (
                                    <p className="text-xs text-amber-600 mt-1">Evaluator could not run — may require tool_definitions or has limited support with this agent&apos;s tool types.</p>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-stroke-divider">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      'h-8 w-8 rounded-lg text-xs font-medium transition-colors',
                      page === currentPage
                        ? 'bg-accent text-fg-on-accent'
                        : 'text-fg-muted hover:bg-bg-secondary'
                    )}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </div>
        )
      })()}
    </div>
  )
}

function SummaryCard({ label, value, color, subtitle }: { label: string; value: number; color?: string; subtitle?: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-600 dark:text-green-400',
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }
  return (
    <div className="rounded-xl border border-stroke-divider bg-bg-card p-4 text-center">
      <p className="text-2xl font-bold text-fg-default">
        <span className={colorMap[color || ''] || ''}>{value}</span>
      </p>
      <p className="text-xs text-fg-muted mt-0.5">{label}</p>
      {subtitle && <p className="text-[10px] text-fg-subtle mt-0.5">{subtitle}</p>}
    </div>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
      <ResultsContent />
    </Suspense>
  )
}
