'use client'

export const dynamic = 'force-dynamic'

import React, { Suspense, useEffect, useState } from 'react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadingSkeleton } from '@/components/shared/loading-skeleton'
import { ErrorState } from '@/components/shared/error-state'
import { StatusPill } from '@/components/shared/status-pill'
import { AgentAvatar } from '@/components/agent-avatar'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { FormLabel } from '@/components/ui/form'
import {
  Bot20Regular,
  Play20Regular,
  Settings20Regular,
  Delete20Regular,
  Warning20Regular,
  Search20Regular,
  Code20Regular,
  DocumentSearch20Regular,
  Add20Regular,
} from '@fluentui/react-icons'
import { useRouter } from 'next/navigation'
import { formatRelativeTime } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type FoundryAssistant = {
  id: string
  name: string
  model: string
  instructions?: string
  tools: { type: string }[]
  tool_resources?: {
    azure_ai_search?: {
      indexes?: { index_connection_id: string; index_name: string }[]
    }
  }
  created_at: number
  metadata?: Record<string, string>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  azure_ai_search: { label: 'Azure AI Search', Icon: Search20Regular },
  code_interpreter: { label: 'Code Interpreter', Icon: Code20Regular },
  file_search: { label: 'File Search', Icon: DocumentSearch20Regular },
}

function getToolLabel(type: string) {
  return TOOL_DISPLAY[type]?.label ?? type
}

function getIndexDisplayName(indexName: string) {
  return indexName.endsWith('-index') ? indexName.slice(0, -6) : indexName
}

// ── Page Content ─────────────────────────────────────────────────────────────

function AgentsPageContent() {
  const router = useRouter()
  const { toast } = useToast()

  const [agents, setAgents] = useState<FoundryAssistant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; agent: FoundryAssistant | null }>({ open: false, agent: null })
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    fetchAgents()
  }, [])

  const fetchAgents = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/foundry/assistants', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.status}`)
      }

      const data = await response.json()
      setAgents(data.data || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load agents')
      console.error('Error fetching agents:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (agent: FoundryAssistant) => {
    if (deleteConfirmName !== agent.name) return

    try {
      setDeleteLoading(true)
      const response = await fetch(`/api/foundry/assistants/${agent.id}`, { method: 'DELETE' })

      if (!response.ok) {
        throw new Error('Failed to delete agent')
      }

      setAgents(prev => prev.filter(a => a.id !== agent.id))
      toast({
        type: 'success',
        title: 'Agent deleted',
        description: `"${agent.name}" has been permanently removed.`,
      })
    } catch (err: any) {
      console.error('Error deleting agent:', err)
      toast({
        type: 'error',
        title: 'Delete failed',
        description: err.message || 'Failed to delete agent',
      })
    } finally {
      setDeleteLoading(false)
      setDeleteDialog({ open: false, agent: null })
      setDeleteConfirmName('')
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agents" description="Manage your Foundry agents" />
        <LoadingSkeleton />
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agents" description="Manage your Foundry agents" />
        <ErrorState
          title="Error loading agents"
          description={error}
          action={{ label: 'Try again', onClick: fetchAgents }}
        />
      </div>
    )
  }

  // ── Main ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Foundry agents powered by Azure AI Search knowledge"
        primaryAction={{
          label: 'Create Agent',
          onClick: () => router.push('/agent-builder'),
          icon: Add20Regular,
        }}
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot20Regular}
          title="No agents yet"
          description="Create your first Foundry agent to start chatting with your knowledge bases."
          action={{
            label: 'Create Agent',
            onClick: () => router.push('/agent-builder'),
          }}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const searchIndexes = agent.tool_resources?.azure_ai_search?.indexes ?? []
            const uniqueToolTypes = Array.from(new Set(agent.tools.map(t => t.type)))
            const createdDate = new Date(agent.created_at * 1000)

            return (
              <div key={agent.id} className="transform-gpu">
                <Card
                  className="h-[380px] flex flex-col transition-all duration-200 cursor-pointer group relative overflow-hidden border-2 hover:border-accent/50 hover:shadow-xl hover:-translate-y-1"
                  onClick={() => router.push(`/agent-builder?assistantId=${encodeURIComponent(agent.id)}`)}
                >
                  {/* Hover gradient */}
                  <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                  {/* Header */}
                  <CardHeader className="pb-2 flex-shrink-0 relative z-10">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AgentAvatar size={36} iconSize={18} variant="subtle" title={agent.name} className="group-hover:scale-110 transition-transform duration-200" />
                          <CardTitle className="text-base truncate font-semibold">{agent.name}</CardTitle>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-glass-border bg-glass-surface px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
                            {agent.model}
                          </span>
                          <StatusPill variant="success">active</StatusPill>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteDialog({ open: true, agent })
                        }}
                        className="h-7 w-7 text-fg-muted hover:text-destructive hover:bg-destructive/10 flex-shrink-0 hover:scale-110 transition-transform"
                      >
                        <Delete20Regular className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {agent.instructions && (
                      <CardDescription className="text-xs line-clamp-2 mt-1.5 text-fg-muted">
                        {agent.instructions}
                      </CardDescription>
                    )}
                  </CardHeader>

                  {/* Body */}
                  <CardContent className="flex-1 flex flex-col min-h-0 space-y-3 px-4 pb-3 relative z-10">
                    {/* Tools */}
                    {uniqueToolTypes.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Tools</div>
                        <div className="flex flex-wrap gap-1.5">
                          {uniqueToolTypes.map((type) => {
                            const display = TOOL_DISPLAY[type]
                            const Icon = display?.Icon
                            return (
                              <span
                                key={type}
                                className="inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-surface px-2.5 py-1 text-xs font-medium text-fg-muted"
                              >
                                {Icon && <Icon className="h-3 w-3" />}
                                {getToolLabel(type)}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Connected indexes */}
                    {searchIndexes.length > 0 && (
                      <div className="flex-1 min-h-0 flex flex-col">
                        <div className="mb-2 text-xs font-semibold text-fg-default flex items-center gap-1.5 flex-shrink-0">
                          <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                          {searchIndexes.length} Index{searchIndexes.length !== 1 ? 'es' : ''}
                        </div>
                        <div className="flex flex-wrap gap-1.5 content-start overflow-y-auto pr-1 custom-scrollbar thin max-h-[80px]">
                          {searchIndexes.map((idx, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-subtle rounded-full border border-stroke-divider text-xs font-medium text-fg-default truncate max-w-[160px]"
                              title={idx.index_name}
                            >
                              <Search20Regular className="h-3 w-3 flex-shrink-0 text-accent" />
                              {getIndexDisplayName(idx.index_name)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>

                  {/* Footer */}
                  <CardFooter className="pt-2 pb-3 flex-shrink-0 relative z-10 gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/agent-builder?assistantId=${encodeURIComponent(agent.id)}`)
                      }}
                    >
                      <Play20Regular className="h-3.5 w-3.5 mr-1.5" />
                      Chat
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/agent-builder?assistantId=${encodeURIComponent(agent.id)}&mode=edit`)
                      }}
                    >
                      <Settings20Regular className="h-3.5 w-3.5 mr-1.5" />
                      Configure
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Delete Confirmation Dialog ──────────────────────────────────────── */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => {
          setDeleteDialog({ open, agent: null })
          if (!open) setDeleteConfirmName('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-destructive/10">
                <Warning20Regular className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle>Delete Agent</DialogTitle>
            </div>
            <DialogDescription className="mt-3">
              This action cannot be undone. This will permanently delete the agent and all associated thread history.
            </DialogDescription>
          </DialogHeader>
          {deleteDialog.agent && (
            <div className="pt-6 pb-4 space-y-3">
              <FormLabel className="block text-sm font-medium">
                Type <span className="font-mono font-semibold text-fg-default">{deleteDialog.agent.name}</span> to confirm:
              </FormLabel>
              <Input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={deleteDialog.agent.name}
                className="w-full"
                autoComplete="off"
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialog({ open: false, agent: null })
                setDeleteConfirmName('')
              }}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteDialog.agent && handleDelete(deleteDialog.agent)}
              disabled={!deleteDialog.agent || deleteConfirmName !== deleteDialog.agent.name || deleteLoading}
            >
              {deleteLoading ? 'Deleting...' : 'Delete Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Default Export with Suspense ──────────────────────────────────────────────

export default function AgentsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <AgentsPageContent />
    </Suspense>
  )
}
