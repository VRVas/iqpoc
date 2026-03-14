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

type FoundryAgentV2 = {
  object: string
  id: string
  name: string
  versions?: {
    latest?: {
      object: string
      id: string
      name: string
      version: string
      description: string
      created_at: number
      definition?: {
        kind: string
        model: string
        instructions?: string
        tools?: { type: string; server_label?: string; server_url?: string }[]
      }
    }
  }
}

// Also keep classic type for backward compat
type FoundryAssistant = {
  id: string
  name: string
  model: string
  instructions?: string
  tools: { type: string }[]
  tool_resources?: {
    azure_ai_search?: {
      indexes?: { index_connection_id: string | null; index_name: string | null; index_asset_id?: string | null }[]
    }
  }
  created_at: number
  metadata?: Record<string, string>
}

// Unified display type
type AgentDisplay = {
  id: string
  name: string
  model: string
  instructions?: string
  tools: { type: string; server_label?: string }[]
  knowledgeBases: string[]
  created_at: number
  apiVersion: 'v2' | 'classic'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOOL_DISPLAY: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  azure_ai_search: { label: 'Azure AI Search', Icon: Search20Regular },
  code_interpreter: { label: 'Code Interpreter', Icon: Code20Regular },
  file_search: { label: 'File Search', Icon: DocumentSearch20Regular },
  mcp: { label: 'Knowledge Base (MCP)', Icon: Search20Regular },
}

function getToolLabel(type: string) {
  return TOOL_DISPLAY[type]?.label ?? type
}

function getIndexDisplayName(indexName: string | null | undefined) {
  if (!indexName) return 'unknown'
  return indexName.endsWith('-index') ? indexName.slice(0, -6) : indexName
}

// ── Page Content ─────────────────────────────────────────────────────────────

function AgentsPageContent() {
  const router = useRouter()
  const { toast } = useToast()

  const [agents, setAgents] = useState<AgentDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; agent: AgentDisplay | null }>({ open: false, agent: null })
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    fetchAgents()
  }, [])

  /**
   * Fetch agents from BOTH v2 and classic APIs, merge into unified display list.
   * v2 agents take priority (shown first), classic shown after with a badge.
   */
  const fetchAgents = async () => {
    try {
      setLoading(true)
      setError(null)

      const displayAgents: AgentDisplay[] = []

      // 1. Fetch v2 agents
      try {
        const v2Response = await fetch('/api/foundry/agents', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
        })
        if (v2Response.ok) {
          const v2Data = await v2Response.json()
          const v2Agents: FoundryAgentV2[] = v2Data.data || []
          for (const agent of v2Agents) {
            const def = agent.versions?.latest?.definition
            const tools = def?.tools || []
            // Extract KB names from MCP tool server_urls
            const kbNames: string[] = []
            for (const tool of tools) {
              if (tool.type === 'mcp' && tool.server_url) {
                const match = tool.server_url.match(/\/knowledgebases\/([^/]+)\/mcp/)
                if (match) kbNames.push(match[1])
              }
            }
            displayAgents.push({
              id: agent.name,
              name: agent.name,
              model: def?.model || 'unknown',
              instructions: def?.instructions,
              tools: tools.map(t => ({ type: t.type, server_label: t.server_label })),
              knowledgeBases: kbNames,
              created_at: agent.versions?.latest?.created_at || 0,
              apiVersion: 'v2',
            })
          }
        }
      } catch (v2Err) {
        console.warn('Failed to fetch v2 agents:', v2Err)
      }

      // 2. Fetch classic agents
      try {
        const classicResponse = await fetch('/api/foundry/assistants', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
        })
        if (classicResponse.ok) {
          const classicData = await classicResponse.json()
          const classicAgents: FoundryAssistant[] = classicData.data || []
          // Only add classic agents that don't exist in v2 (by name)
          const v2Names = new Set(displayAgents.map(a => a.name))
          for (const agent of classicAgents) {
            if (!v2Names.has(agent.name)) {
              const searchIndexes = agent.tool_resources?.azure_ai_search?.indexes ?? []
              displayAgents.push({
                id: agent.id,
                name: agent.name,
                model: agent.model,
                instructions: agent.instructions,
                tools: agent.tools || [],
                knowledgeBases: searchIndexes.map(idx => getIndexDisplayName(idx.index_name)),
                created_at: agent.created_at,
                apiVersion: 'classic',
              })
            }
          }
        }
      } catch (classicErr) {
        console.warn('Failed to fetch classic agents:', classicErr)
      }

      if (displayAgents.length === 0) {
        // If both failed, throw to show error state
        const v2Resp = await fetch('/api/foundry/agents', { cache: 'no-store' })
        if (!v2Resp.ok) throw new Error(`Failed to fetch agents: ${v2Resp.status}`)
      }

      setAgents(displayAgents)
    } catch (err: any) {
      setError(err.message || 'Failed to load agents')
      console.error('Error fetching agents:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (agent: AgentDisplay) => {
    if (deleteConfirmName !== agent.name) return

    try {
      setDeleteLoading(true)

      // Delete via appropriate API based on agent version
      const deleteUrl = agent.apiVersion === 'v2'
        ? `/api/foundry/agents/${encodeURIComponent(agent.name)}`
        : `/api/foundry/assistants/${agent.id}`

      const response = await fetch(deleteUrl, { method: 'DELETE' })

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
            const uniqueToolTypes = Array.from(new Set(agent.tools.map(t => t.type)))
            const createdDate = new Date(agent.created_at * 1000)

            return (
              <div key={agent.id} className="transform-gpu">
                <Card
                  className="h-[380px] flex flex-col transition-all duration-200 cursor-pointer group relative overflow-hidden border-2 hover:border-accent/50 hover:shadow-xl hover:-translate-y-1"
                  onClick={() => router.push(`/agent-builder?assistantId=${encodeURIComponent(agent.name)}&mode=playground`)}
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
                          {agent.apiVersion === 'v2' ? (
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">v2</span>
                          ) : (
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">classic</span>
                          )}
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

                    {/* Connected Knowledge Bases */}
                    {agent.knowledgeBases.length > 0 && (
                      <div className="flex-1 min-h-0 flex flex-col">
                        <div className="mb-2 text-xs font-semibold text-fg-default flex items-center gap-1.5 flex-shrink-0">
                          <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                          {agent.knowledgeBases.length} Knowledge Base{agent.knowledgeBases.length !== 1 ? 's' : ''}
                        </div>
                        <div className="flex flex-wrap gap-1.5 content-start overflow-y-auto pr-1 custom-scrollbar thin max-h-[80px]">
                          {agent.knowledgeBases.map((kbName, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-bg-subtle rounded-full border border-stroke-divider text-xs font-medium text-fg-default truncate max-w-[160px]"
                              title={kbName}
                            >
                              <Search20Regular className="h-3 w-3 flex-shrink-0 text-accent" />
                              {kbName}
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
                        router.push(`/agent-builder?assistantId=${encodeURIComponent(agent.name)}&mode=playground`)
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
                        router.push(`/agent-builder?assistantId=${encodeURIComponent(agent.name)}&mode=edit`)
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
