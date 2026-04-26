'use client'

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface EvalScore {
  name: string
  score: number | null
  passed: boolean | null
  label?: string
}

interface EvalScoreBubbleProps {
  agentName: string
  responseId: string | null
  className?: string
}

/**
 * On-the-go evaluation score bubble for agent chat messages.
 * 
 * Triggers an explicit per-response evaluation via the eval service,
 * then polls for results. Shows a small pill with aggregate pass/fail.
 * On click, expands to show per-evaluator details.
 * 
 * Only rendered in admin mode.
 */
export function EvalScoreBubble({ agentName, responseId, className }: EvalScoreBubbleProps) {
  const [scores, setScores] = useState<EvalScore[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [failed, setFailed] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const startTime = useRef(Date.now())

  useEffect(() => {
    if (!responseId) {
      setLoading(false)
      setFailed(true)
      return
    }

    let cancelled = false
    const maxPollAttempts = 30 // poll for ~90s max (eval takes time)
    const pollInterval = 3000

    const runEval = async () => {
      // Step 1: Trigger the evaluation
      console.log(`[on-the-go] Starting eval for response: ${responseId}`)
      try {
        const triggerResp = await fetch('/api/eval/on-the-go', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response_id: responseId }),
        })
        if (!triggerResp.ok) {
          const err = await triggerResp.text()
          console.error('[on-the-go] Failed to trigger eval:', err)
          setLoading(false)
          setFailed(true)
          return
        }
        const { eval_id, run_id } = await triggerResp.json()
        console.log(`[on-the-go] Eval triggered: eval_id=${eval_id}, run_id=${run_id}`)

        // Step 2: Poll for results
        let attempts = 0
        const poll = async () => {
          if (cancelled) return
          attempts++
          setElapsed(Math.round((Date.now() - startTime.current) / 1000))

          try {
            const statusResp = await fetch(
              `/api/eval/on-the-go/status?eval_id=${encodeURIComponent(eval_id)}&run_id=${encodeURIComponent(run_id)}`
            )
            if (!statusResp.ok) throw new Error(`status fetch failed: ${statusResp.status}`)
            const data = await statusResp.json()
            console.log(`[on-the-go] Poll ${attempts}: status=${data.status}`)

            if (data.status === 'completed' && data.per_evaluator) {
              const evalScores: EvalScore[] = data.per_evaluator.map((e: any) => ({
                name: e.name,
                score: e.pass_rate != null ? e.pass_rate : null,
                passed: e.failed === 0 && e.passed > 0,
              }))
              console.log(`[on-the-go] Scores:`, evalScores.map(s => `${s.name}=${s.passed ? 'pass' : 'fail'}`).join(', '))
              setScores(evalScores)
              setLoading(false)
              setElapsed(Math.round((Date.now() - startTime.current) / 1000))
              return
            }

            if (data.status === 'failed') {
              console.error('[on-the-go] Eval run failed:', data)
              setLoading(false)
              setFailed(true)
              return
            }

            // Still running — continue polling
            if (attempts < maxPollAttempts && !cancelled) {
              setTimeout(poll, pollInterval)
            } else if (!cancelled) {
              console.log('[on-the-go] Max poll attempts reached')
              setLoading(false)
            }
          } catch (err) {
            console.log(`[on-the-go] Poll ${attempts} error:`, err)
            if (attempts < maxPollAttempts && !cancelled) {
              setTimeout(poll, pollInterval)
            } else if (!cancelled) {
              setLoading(false)
            }
          }
        }

        // Start polling after a short delay
        setTimeout(poll, 3000)
      } catch (err) {
        console.error('[on-the-go] Error triggering eval:', err)
        setLoading(false)
        setFailed(true)
      }
    }

    runEval()

    return () => { cancelled = true }
  }, [responseId])

  // Close popover on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    if (expanded) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [expanded])

  if (!responseId) return null

  const passed = scores.filter(s => s.passed === true).length
  const total = scores.length
  const allPassed = total > 0 && passed === total
  const hasFails = scores.some(s => s.passed === false)
  const noScores = !loading && total === 0

  return (
    <div className={cn('relative inline-flex', className)} ref={popoverRef}>
      <button
        onClick={() => !loading && setExpanded(!expanded)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
          'border backdrop-blur-sm',
          loading
            ? 'border-blue-300/50 bg-blue-50/50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
            : noScores
              ? 'border-gray-300/50 bg-gray-50/50 dark:bg-gray-800/20 text-gray-500 dark:text-gray-400'
              : allPassed
                ? 'border-green-300/50 bg-green-50/50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100/70'
                : hasFails
                  ? 'border-red-300/50 bg-red-50/50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100/70'
                  : 'border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100/70'
        )}
        disabled={loading}
      >
        {loading ? (
          <>
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" className="opacity-25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-75" />
            </svg>
            <span>Evaluating... {elapsed}s</span>
          </>
        ) : noScores ? (
          <>
            <span>📊</span>
            <span>pending</span>
          </>
        ) : (
          <>
            <span>📊</span>
            <span>{passed}/{total}</span>
            <span>{allPassed ? '✓' : hasFails ? '✗' : '⚠'}</span>
          </>
        )}
      </button>

      <AnimatePresence>
        {expanded && scores.length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute bottom-full left-0 mb-2 z-50 w-64 rounded-xl border border-stroke-divider bg-bg-card shadow-xl overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-stroke-divider bg-bg-secondary">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg-default">On-The-Go Evaluation</span>
                <span className="text-[10px] text-fg-muted">{elapsed}s</span>
              </div>
            </div>
            <div className="p-2 space-y-1">
              {scores.map((s, i) => (
                <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-bg-secondary transition-colors">
                  <span className="text-xs text-fg-default font-medium">{s.name}</span>
                  <div className="flex items-center gap-2">
                    {s.score !== null && s.score !== undefined && (
                      <span className="text-xs text-fg-muted font-mono">{typeof s.score === 'number' ? s.score.toFixed(1) : s.score}</span>
                    )}
                    <span className={cn(
                      'text-xs font-medium px-1.5 py-0.5 rounded',
                      s.passed === true
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : s.passed === false
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    )}>
                      {s.passed === true ? 'pass' : s.passed === false ? 'fail' : 'n/a'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 py-1.5 border-t border-stroke-divider">
              <span className="text-[10px] text-fg-muted">Powered by Per-Response Eval · {agentName}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
