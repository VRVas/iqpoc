'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight20Regular,
  Play20Regular,
  Shield20Regular,
  DataBarVertical20Regular,
  BrainCircuit20Regular,
  ArrowSync20Regular,
  Beaker20Regular,
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'

interface EvalServiceHealth {
  status: string
  version: string
  model_deployment: string
  app_insights_configured: boolean
}

export default function EvaluationsPage() {
  const router = useRouter()
  const [health, setHealth] = useState<EvalServiceHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)

  useEffect(() => {
    fetch('/api/eval/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Evaluations"
        description="Monitor, evaluate, and red-team your AI agents"
      />

      {/* Service Status Card */}
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'h-3 w-3 rounded-full',
              healthLoading ? 'bg-yellow-400 animate-pulse' :
              health?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
            )} />
            <div>
              <h3 className="text-sm font-semibold text-fg-default">Evaluation Service</h3>
              <p className="text-xs text-fg-muted">
                {healthLoading ? 'Checking...' :
                 health?.status === 'healthy'
                   ? `v${health.version} · ${health.model_deployment} · App Insights ${health.app_insights_configured ? 'connected' : 'not connected'}`
                   : 'Service unreachable'}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setHealthLoading(true); fetch('/api/eval/health').then(r => r.json()).then(setHealth).finally(() => setHealthLoading(false)) }}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Action Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Run Evaluation */}
        <ActionCard
          icon={Play20Regular}
          title="Run Evaluation"
          description="Trigger a batch, agent-target, or synthetic evaluation against your agent"
          color="accent"
          onClick={() => router.push('/evaluations/run?edit=admin')}
        />

        {/* Evaluation Results */}
        <ActionCard
          icon={DataBarVertical20Regular}
          title="View Results"
          description="Browse past evaluation runs, drill into per-item scores and reasoning"
          color="blue"
          onClick={() => router.push('/evaluations/results?edit=admin')}
        />

        {/* Continuous & Scheduled Evaluation */}
        <ActionCard
          icon={ArrowSync20Regular}
          title="Continuous & Scheduled"
          description="Automatic evaluation rules and recurring schedules for production agents"
          color="green"
          onClick={() => router.push('/evaluations/continuous?edit=admin')}
        />

        {/* Red Teaming */}
        <ActionCard
          icon={Shield20Regular}
          title="Red Teaming"
          description="Run adversarial probing with taxonomy-based attack strategies"
          color="red"
          onClick={() => router.push('/evaluations/red-team?edit=admin')}
        />

        {/* Custom Evaluators */}
        <ActionCard
          icon={Beaker20Regular}
          title="Custom Evaluators"
          description="Create domain-specific evaluators for KB citations, MCP accuracy, and style"
          color="accent"
          onClick={() => router.push('/evaluations/custom-evaluators?edit=admin')}
        />
      </div>

      {/* Available Evaluators */}
      <EvaluatorCatalog />
    </div>
  )
}

function ActionCard({ icon: Icon, title, description, color, onClick }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  color: string
  onClick: () => void
}) {
  const colorMap: Record<string, string> = {
    accent: 'border-accent/30 hover:border-accent/60 bg-accent/5',
    blue: 'border-blue-500/30 hover:border-blue-500/60 bg-blue-500/5',
    red: 'border-red-500/30 hover:border-red-500/60 bg-red-500/5',
    green: 'border-green-500/30 hover:border-green-500/60 bg-green-500/5',
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'group rounded-2xl border p-6 text-left transition-all duration-200',
        colorMap[color] || colorMap.accent
      )}
    >
      <Icon className="h-6 w-6 text-fg-muted mb-3" />
      <h3 className="text-base font-semibold text-fg-default mb-1">{title}</h3>
      <p className="text-sm text-fg-muted leading-relaxed">{description}</p>
      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-accent opacity-0 group-hover:opacity-100 transition-opacity">
        Get started <ArrowRight20Regular className="h-3 w-3" />
      </div>
    </button>
  )
}

function EvaluatorCatalog() {
  const [evaluators, setEvaluators] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/eval/evaluators')
      .then(r => r.json())
      .then(setEvaluators)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
        <h3 className="text-sm font-semibold text-fg-default mb-4">Available Evaluators</h3>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-8 bg-bg-secondary rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (!evaluators || !evaluators.built_in) return null

  const builtIn = evaluators.built_in || []
  const custom = evaluators.custom || []

  const categories = [
    { key: 'quality', label: 'Quality', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
    { key: 'rag', label: 'RAG', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
    { key: 'safety', label: 'Safety', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
    { key: 'agent', label: 'Agent', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
    { key: 'similarity', label: 'Similarity', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    { key: 'domain', label: 'Custom', color: 'bg-accent/10 text-accent' },
  ]

  return (
    <div className="rounded-2xl border border-stroke-divider bg-bg-card p-6">
      <h3 className="text-sm font-semibold text-fg-default mb-4">Available Evaluators ({builtIn.length + custom.length})</h3>
      <div className="space-y-4">
        {categories.map(cat => {
          const items = cat.key === 'domain'
            ? custom
            : builtIn.filter((e: any) => e.category === cat.key)
          if (!items || items.length === 0) return null
          return (
            <div key={cat.key}>
              <span className={cn('text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full', cat.color)}>
                {cat.label} ({items.length})
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                {items.map((e: any) => (
                  <div key={e.name || e.short_name} className="text-xs px-3 py-2 rounded-xl bg-bg-secondary text-fg-default border border-stroke-card flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{e.short_name || e.name}</span>
                        {e.requires_model && <BrainCircuit20Regular className="h-3 w-3 text-fg-subtle flex-shrink-0" />}
                        {e.caveat && <span className="text-amber-500 flex-shrink-0" title={e.caveat}>⚠</span>}
                      </div>
                      {e.description && <p className="text-[10px] text-fg-muted mt-0.5 leading-relaxed line-clamp-2">{e.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
