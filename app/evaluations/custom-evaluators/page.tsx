'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft20Regular,
  Add20Regular,
  Delete20Regular,
  ArrowClockwise20Regular,
  Code20Regular,
  Chat20Regular,
  Checkmark20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

/**
 * Custom Evaluators Management Page
 *
 * Create, view, and manage custom evaluators in the Foundry evaluator catalog.
 * Supports two types per MS Learn:
 *
 * 1. Code-based: Python grade(sample, item) -> float (0.0-1.0)
 *    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#code-based-evaluators
 *
 * 2. Prompt-based: LLM judge prompt with ordinal/continuous/binary scoring
 *    Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators#prompt-based-evaluators
 *
 * Also provides pre-built domain-specific evaluators for Qatar Airways Contact Center:
 * - kb_citation_checker: Checks if response cites KB sources
 * - mcp_tool_accuracy: Validates MCP tool call parameters
 * - qr_policy_style: QR contact center style compliance
 */

interface CatalogEvaluator {
  name: string
  version: string
  display_name: string
  description: string
  categories: string[]
}

interface PrebuiltEvaluator {
  name: string
  display_name: string
  type: string
  description: string
  category: string
  input_fields: string[]
  code_preview?: string
  prompt_preview?: string
  scoring_type?: string
}

export default function CustomEvaluatorsPage() {
  const router = useRouter()

  // Data
  const [catalogEvaluators, setCatalogEvaluators] = useState<CatalogEvaluator[]>([])
  const [prebuiltEvaluators, setPrebuiltEvaluators] = useState<PrebuiltEvaluator[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [prebuiltLoading, setPrebuiltLoading] = useState(true)

  // Action state
  const [registering, setRegistering] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Custom creation form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [formType, setFormType] = useState<'code' | 'prompt'>('code')
  const [formName, setFormName] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCode, setFormCode] = useState('def grade(sample: dict, item: dict) -> float:\n    """Custom evaluator logic."""\n    response = item.get("response", "")\n    if not response:\n        return 0.0\n    # Add your scoring logic here\n    return 1.0\n')
  const [formPrompt, setFormPrompt] = useState('')
  const [formSubmitting, setFormSubmitting] = useState(false)

  // Load data
  useEffect(() => {
    fetchCatalog()
    fetchPrebuilt()
  }, [])

  const fetchCatalog = () => {
    setCatalogLoading(true)
    fetch('/api/eval/custom-evaluators?action=list')
      .then(r => r.json())
      .then(data => setCatalogEvaluators(data.evaluators || []))
      .catch(() => setCatalogEvaluators([]))
      .finally(() => setCatalogLoading(false))
  }

  const fetchPrebuilt = () => {
    setPrebuiltLoading(true)
    fetch('/api/eval/custom-evaluators?action=prebuilt')
      .then(r => r.json())
      .then(data => setPrebuiltEvaluators(data.evaluators || []))
      .catch(() => setPrebuiltEvaluators([]))
      .finally(() => setPrebuiltLoading(false))
  }

  const registerPrebuilt = async (name: string) => {
    setRegistering(name)
    setActionResult(null)
    try {
      const response = await fetch('/api/eval/custom-evaluators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: `register-prebuilt/${name}` }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Registration failed')
      setActionResult({ type: 'success', message: `${data.display_name || name} registered (v${data.version})` })
      fetchCatalog()
    } catch (err: any) {
      setActionResult({ type: 'error', message: err.message })
    } finally {
      setRegistering(null)
    }
  }

  const deleteEvaluator = async (name: string, version: string) => {
    setDeleting(name)
    setActionResult(null)
    try {
      const response = await fetch('/api/eval/custom-evaluators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name, version }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Delete failed')
      setActionResult({ type: 'success', message: `${name} v${version} deleted` })
      fetchCatalog()
    } catch (err: any) {
      setActionResult({ type: 'error', message: err.message })
    } finally {
      setDeleting(null)
    }
  }

  const handleCreateSubmit = async () => {
    if (!formName || !formDisplayName) return
    setFormSubmitting(true)
    setActionResult(null)

    try {
      const payload: any = {
        action: formType === 'code' ? 'create-code' : 'create-prompt',
        name: formName,
        display_name: formDisplayName,
        description: formDescription,
      }

      if (formType === 'code') {
        payload.code_text = formCode
        payload.input_fields = ['response']
        payload.pass_threshold = 0.5
      } else {
        payload.prompt_text = formPrompt
        payload.input_fields = ['response']
        payload.scoring_type = 'ordinal'
        payload.min_value = 1
        payload.max_value = 5
        payload.threshold = 3
      }

      const response = await fetch('/api/eval/custom-evaluators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || data.detail || 'Creation failed')
      setActionResult({ type: 'success', message: `${data.display_name || formName} created (v${data.version})` })
      setShowCreateForm(false)
      setFormName('')
      setFormDisplayName('')
      setFormDescription('')
      fetchCatalog()
    } catch (err: any) {
      setActionResult({ type: 'error', message: err.message })
    } finally {
      setFormSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Custom Evaluators"
          description="Create and manage domain-specific evaluators in the Foundry catalog"
        />
        <Button variant="ghost" size="sm" onClick={() => router.push('/evaluations?edit=admin')}>
          <ArrowLeft20Regular className="h-4 w-4 mr-1" /> Back
        </Button>
      </div>

      {/* Info Banner */}
      <div className="rounded-xl border border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-800 p-4 text-sm text-purple-700 dark:text-purple-300">
        <strong>Custom evaluators</strong> let you define domain-specific metrics beyond the built-in catalog.
        Use <strong>code-based</strong> evaluators for deterministic checks (keyword matching, format validation)
        and <strong>prompt-based</strong> evaluators for subjective quality judgments (tone, style, completeness).
        <a
          href="https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators"
          target="_blank"
          className="ml-1 underline"
        >
          Learn more
        </a>
      </div>

      {/* Action Result */}
      {actionResult && (
        <div className={cn(
          'rounded-xl border p-4 text-sm',
          actionResult.type === 'success'
            ? 'border-green-300 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'border-red-300 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        )}>
          {actionResult.message}
        </div>
      )}

      {/* Pre-built Evaluators */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-4">Pre-built Domain Evaluators</h3>
        <p className="text-xs text-fg-muted mb-4">
          Ready-to-use evaluators designed for the Qatar Airways Contact Center. Click &ldquo;Register&rdquo; to add them to your Foundry evaluator catalog.
        </p>

        {prebuiltLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-bg-secondary rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {prebuiltEvaluators.map(ev => {
              const isRegistered = catalogEvaluators.some(c => c.name === ev.name)
              return (
                <div key={ev.name} className="rounded-xl border border-stroke-card p-4 flex items-start gap-4">
                  <div className={cn(
                    'h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0',
                    ev.type === 'code' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-purple-100 dark:bg-purple-900/30'
                  )}>
                    {ev.type === 'code'
                      ? <Code20Regular className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      : <Chat20Regular className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-fg-default">{ev.display_name}</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        ev.type === 'code'
                          ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                      )}>
                        {ev.type === 'code' ? 'Code-based' : 'Prompt-based'}
                      </span>
                      {isRegistered && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-300 font-medium flex items-center gap-0.5">
                          <Checkmark20Regular className="h-3 w-3" /> Registered
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted mt-0.5 leading-relaxed">{ev.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-fg-subtle">Fields: {ev.input_fields?.join(', ')}</span>
                      {ev.scoring_type && <span className="text-[10px] text-fg-subtle">Scoring: {ev.scoring_type}</span>}
                    </div>
                  </div>
                  <Button
                    variant={isRegistered ? 'ghost' : 'outline'}
                    size="sm"
                    disabled={registering === ev.name || isRegistered}
                    onClick={() => registerPrebuilt(ev.name)}
                  >
                    {registering === ev.name ? 'Registering...' : isRegistered ? 'Registered' : 'Register'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Catalog Evaluators */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-fg-default">Registered Custom Evaluators ({catalogEvaluators.length})</h3>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={fetchCatalog} disabled={catalogLoading}>
              <ArrowClockwise20Regular className={cn("h-4 w-4 mr-1", catalogLoading && "animate-spin")} /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowCreateForm(!showCreateForm)}>
              <Add20Regular className="h-4 w-4 mr-1" /> Create New
            </Button>
          </div>
        </div>

        {catalogLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2].map(i => <div key={i} className="h-12 bg-bg-secondary rounded-lg" />)}
          </div>
        ) : catalogEvaluators.length === 0 ? (
          <p className="text-sm text-fg-muted py-6 text-center">No custom evaluators registered yet. Register a pre-built one above or create a new one.</p>
        ) : (
          <div className="space-y-2">
            {catalogEvaluators.map(ev => (
              <div key={`${ev.name}-${ev.version}`} className="flex items-center justify-between px-4 py-3 rounded-xl border border-stroke-card bg-bg-secondary">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg-default">{ev.display_name || ev.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-card text-fg-muted">v{ev.version}</span>
                    {ev.categories?.map(c => (
                      <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">{c}</span>
                    ))}
                  </div>
                  {ev.description && <p className="text-[10px] text-fg-muted mt-0.5">{ev.description}</p>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  disabled={deleting === ev.name}
                  onClick={() => deleteEvaluator(ev.name, ev.version)}
                >
                  {deleting === ev.name ? '...' : <Delete20Regular className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="rounded-2xl border border-accent/30 bg-bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold text-fg-default">Create Custom Evaluator</h3>

          {/* Type Selection */}
          <div className="flex gap-2">
            <button
              onClick={() => setFormType('code')}
              className={cn(
                'flex-1 rounded-xl border px-4 py-3 text-left transition-all',
                formType === 'code' ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'border-stroke-card'
              )}
            >
              <Code20Regular className="h-4 w-4 text-blue-600 mb-1" />
              <span className="text-sm font-medium text-fg-default block">Code-based</span>
              <p className="text-[10px] text-fg-muted">Python grade() function, 0.0-1.0 score</p>
            </button>
            <button
              onClick={() => setFormType('prompt')}
              className={cn(
                'flex-1 rounded-xl border px-4 py-3 text-left transition-all',
                formType === 'prompt' ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/20' : 'border-stroke-card'
              )}
            >
              <Chat20Regular className="h-4 w-4 text-purple-600 mb-1" />
              <span className="text-sm font-medium text-fg-default block">Prompt-based</span>
              <p className="text-[10px] text-fg-muted">LLM judge prompt, ordinal/binary scoring</p>
            </button>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1">Name (identifier)</label>
              <input
                value={formName}
                onChange={e => setFormName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase())}
                placeholder="my_custom_evaluator"
                className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1">Display Name</label>
              <input
                value={formDisplayName}
                onChange={e => setFormDisplayName(e.target.value)}
                placeholder="My Custom Evaluator"
                className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-fg-muted block mb-1">Description</label>
            <input
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="What this evaluator measures..."
              className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-2.5 text-sm text-fg-default"
            />
          </div>

          {formType === 'code' ? (
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1">
                Python Code <span className="text-fg-subtle">(must define grade(sample, item) returning 0.0-1.0)</span>
              </label>
              <textarea
                value={formCode}
                onChange={e => setFormCode(e.target.value)}
                rows={10}
                className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-3 text-xs text-fg-default font-mono resize-y leading-relaxed"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-fg-muted block mb-1">
                Judge Prompt <span className="text-fg-subtle">(use {'{{response}}'}, {'{{query}}'} for template variables)</span>
              </label>
              <textarea
                value={formPrompt}
                onChange={e => setFormPrompt(e.target.value)}
                rows={10}
                placeholder={'Evaluate the response on...\n\nResponse:\n{{response}}\n\nOutput Format (JSON):\n{\n  "result": <integer from 1 to 5>,\n  "reason": "<explanation>"\n}'}
                className="w-full rounded-xl border border-stroke-card bg-bg-secondary px-4 py-3 text-xs text-fg-default font-mono resize-y leading-relaxed"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-accent hover:bg-accent-hover text-fg-on-accent"
              disabled={formSubmitting || !formName || !formDisplayName}
              onClick={handleCreateSubmit}
            >
              {formSubmitting ? 'Creating...' : 'Create Evaluator'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
