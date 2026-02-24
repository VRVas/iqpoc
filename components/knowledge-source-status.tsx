'use client'

import * as React from 'react'
import { StatusPill } from '@/components/shared/status-pill'
import { getKnowledgeSourceStatus } from '@/lib/api'
import type { KnowledgeSourceStatus, SynchronizationStatus } from '@/types/knowledge-source-status'
import { Loader2 } from 'lucide-react'

interface KnowledgeSourceStatusIndicatorProps {
  sourceName: string
  refreshInterval?: number // milliseconds, default 10000 (10 seconds)
}

const statusVariantMap: Record<SynchronizationStatus, 'success' | 'info' | 'danger' | 'neutral'> = {
  active: 'success',
  idle: 'success',
  error: 'danger',
  notStarted: 'neutral'
}

const statusLabelMap: Record<SynchronizationStatus, string> = {
  active: 'Ready',
  idle: 'Ready',
  error: 'Error',
  notStarted: 'Not Started'
}

export function KnowledgeSourceStatusIndicator({
  sourceName,
  refreshInterval = 10000
}: KnowledgeSourceStatusIndicatorProps) {
  const [status, setStatus] = React.useState<KnowledgeSourceStatus | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchStatus = React.useCallback(async () => {
    try {
      const data = await getKnowledgeSourceStatus(sourceName)
      setStatus(data)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch knowledge source status:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch status')
    } finally {
      setIsLoading(false)
    }
  }, [sourceName])

  React.useEffect(() => {
    fetchStatus()

    // Set up polling if the source is actively syncing or if refresh interval is provided
    const interval = setInterval(fetchStatus, refreshInterval)

    return () => clearInterval(interval)
  }, [fetchStatus, refreshInterval])

  if (isLoading) {
    return (
      <StatusPill variant="neutral">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Loading
      </StatusPill>
    )
  }

  if (error || !status) {
    return (
      <StatusPill variant="neutral">
        Unknown
      </StatusPill>
    )
  }

  const variant = statusVariantMap[status.synchronizationStatus] || 'neutral'
  const isSyncing = status.synchronizationStatus === 'active' && status.currentSynchronizationState != null
  const label = isSyncing ? 'Syncing' : (statusLabelMap[status.synchronizationStatus] || status.synchronizationStatus)

  return (
    <StatusPill variant={isSyncing ? 'info' : variant}>
      {isSyncing && (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      )}
      {label}
    </StatusPill>
  )
}
