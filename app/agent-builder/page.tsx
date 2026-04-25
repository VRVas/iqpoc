'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronLeft20Regular,
  Add20Regular,
  Database20Regular,
  Bot20Regular,
  Settings20Regular,
  Code20Regular,
  BookInformation20Regular,
  CheckmarkCircle20Filled,
  Circle20Regular,
  Dismiss20Regular,
  CodeText20Regular,
  History20Regular,
  Delete20Regular,
  Airplane20Regular
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { fetchKnowledgeBases, fetchKnowledgeSources, createFoundryAgentV2, createConversation, sendAgentResponse } from '@/lib/api'
import { LoadingSkeleton } from '@/components/shared/loading-skeleton'
import { AgentCodeModal } from '@/components/agent-code-modal'
import { cn } from '@/lib/utils'
import { InlineCitationsText, SourcesCountButton } from '@/components/inline-citations'
import { EvalScoreBubble } from '@/components/eval-score-bubble'
import { MarkdownMessage } from '@/components/markdown-message'
import { SourcesPanel } from '@/components/sources-panel'
import { RuntimeSettingsPanel } from '@/components/runtime-settings-panel'
import { SourceKindIcon } from '@/components/source-kind-icon'
import { KnowledgeBaseReference, KnowledgeBaseActivityRecord } from '@/types/knowledge-retrieval'
import { useViewMode } from '@/lib/view-mode'

interface KnowledgeSource {
  name: string
  kind?: string
  azureBlobParameters?: {
    createdResources?: {
      index?: string
    }
  }
  [key: string]: any
}

interface KnowledgeBase {
  name: string
  description?: string
  knowledgeSources?: { name: string }[]
}

type Section = 'model' | 'tools' | 'instructions' | 'knowledge'
type AgentMode = 'foundry' | 'search'

const SECTIONS = [
  { id: 'model' as Section, label: 'Model', icon: Bot20Regular },
  { id: 'tools' as Section, label: 'Tools', icon: Code20Regular },
  { id: 'instructions' as Section, label: 'Instructions', icon: BookInformation20Regular },
  { id: 'knowledge' as Section, label: 'Knowledge', icon: Database20Regular },
]

function AgentBuilderPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAgent, isAdmin } = useViewMode()
  const returnUrl = searchParams.get('returnUrl')
  const existingAssistantId = searchParams.get('assistantId')
  const mode = searchParams.get('mode')

  const [agentMode, setAgentMode] = useState<AgentMode | null>('foundry')
  const [activeSection, setActiveSection] = useState<Section>('model')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Agent configuration
  const [agentName, setAgentName] = useState(`agent-${Date.now()}`)
  const [agentInstructions, setAgentInstructions] = useState('You are a helpful AI assistant. Answer questions clearly and accurately based on the available knowledge sources.')
  const [selectedModel, setSelectedModel] = useState('gpt-4.1')
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [knowledgeSourcesMap, setKnowledgeSourcesMap] = useState<Map<string, KnowledgeSource>>(new Map())
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<Set<string>>(new Set())
  const [enabledTools, setEnabledTools] = useState({
    codeInterpreter: false,
    fileSearch: false,
    webSearch: false,
    airportOps: false
  })

  // Track whether the agent has MCP knowledge base tools configured
  const [hasKnowledgeTools, setHasKnowledgeTools] = useState(false)

  // Foundry agent state (v2 API — name-based, not asst_ IDs)
  const [agentName_saved, setAgentNameSaved] = useState<string | null>(existingAssistantId || null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<any[]>([])
  const [currentMessage, setCurrentMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)

  // Conversation management (replaces threads)
  const [conversations, setConversations] = useState<any[]>([])
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [showInstructionsModal, setShowInstructionsModal] = useState(false)
  const [showAgentInfo, setShowAgentInfo] = useState(false)

  // Starter questions
  const [starterQuestions, setStarterQuestions] = useState<string[]>([])
  const [generatingStarters, setGeneratingStarters] = useState(false)

  // Continuous eval rule for on-the-go scoring (admin mode)
  const [continuousEvalId, setContinuousEvalId] = useState<string | null>(null)

  // Runtime settings for knowledge source parameters (per-source toggles)
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false)
  const [runtimeSettings, setRuntimeSettings] = useState<{
    knowledgeSourceParams: Array<{
      knowledgeSourceName: string
      kind: string
      alwaysQuerySource?: boolean
      includeReferences?: boolean
      includeReferenceSourceData?: boolean
      rerankerThreshold?: number | null
      headers?: Record<string, string>
    }>
    outputMode?: 'answerSynthesis' | 'extractiveData'
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
    globalHeaders?: Record<string, string>
    answerInstructions?: string
    retrievalInstructions?: string
  }>({
    knowledgeSourceParams: [],
    outputMode: 'answerSynthesis',
    reasoningEffort: 'low',
    globalHeaders: {},
    answerInstructions: '',
    retrievalInstructions: '',
  })

  // Sources panel state (Perplexity-style side panel for citations)
  const [sourcesPanel, setSourcesPanel] = useState<{
    isOpen: boolean
    messageId: string | null
    references: KnowledgeBaseReference[]
    activity: KnowledgeBaseActivityRecord[]
    query?: string
  }>({ isOpen: false, messageId: null, references: [], activity: [] })

  const handleOpenSourcesPanel = (messageId: string, references: KnowledgeBaseReference[], activity: KnowledgeBaseActivityRecord[], query?: string) => {
    setSourcesPanel({ isOpen: true, messageId, references, activity, query })
  }

  const handleCloseSourcesPanel = () => {
    setSourcesPanel(prev => ({ ...prev, isOpen: false }))
  }

  // Save settings state — explicit save to Foundry
  const [savingSettings, setSavingSettings] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [settingsDirty, setSettingsDirty] = useState(false)

  useEffect(() => {
    const init = async () => {
      // Load knowledge bases first
      await loadKnowledgeBases()

      // THEN load existing agent details (v2 API — by name)
      if (existingAssistantId) {
        await loadExistingAgentDetails()
        try {
          const conv = await createConversation()
          setConversationId(conv.id)
          setConversations([{
            id: conv.id,
            created_at: new Date().toISOString(),
            messages: []
          }])
        } catch (err) {
          console.error('Failed to create conversation for existing agent:', err)
        }
      }
    }
    init()
  }, [existingAssistantId, mode])

  // Auto-check for continuous eval rule when agent loads (admin mode)
  // Uses the existing /rules endpoint and matches client-side (works without eval service redeployment)
  useEffect(() => {
    if (!isAdmin || !agentName_saved) return
    fetch('/api/eval/continuous/rules')
      .then(r => r.json())
      .then(data => {
        const rules = data.rules || []
        // Find a rule that matches this agent (by agent_name filter or rule ID containing agent name)
        const match = rules.find((r: any) =>
          (r.agent_name === agentName_saved) ||
          (r.id && r.id.includes(agentName_saved)) ||
          // Fallback: any enabled rule (if only one exists)
          (rules.length === 1 && r.enabled)
        )
        if (match && match.eval_id && match.enabled) {
          setContinuousEvalId(match.eval_id)
          console.log('[on-the-go] Continuous eval rule found:', match.eval_id, 'for agent:', match.agent_name || match.id)
        } else if (match && match.enabled && !match.eval_id) {
          // Rule exists but eval_id not exposed yet (eval service needs redeployment for full details)
          console.log('[on-the-go] Rule found but eval_id not available (eval service needs update):', match.id)
        } else {
          console.log('[on-the-go] No active continuous eval rule for', agentName_saved)
        }
      })
      .catch(() => { /* eval service may be down */ })
  }, [isAdmin, agentName_saved])

  const loadExistingAgentDetails = async () => {
    if (!existingAssistantId) return

    try {
      const response = await fetch(`/api/foundry/agents/${encodeURIComponent(existingAssistantId)}`)
      if (response.ok) {
        const agent = await response.json()
        console.log('Loaded existing agent (v2):', agent)

        // Extract agent details from the latest version definition
        const latestDef = agent.versions?.latest?.definition || agent.definition || {}

        if (agent.name) setAgentName(agent.name)
        if (latestDef.instructions) setAgentInstructions(latestDef.instructions)
        if (latestDef.model) setSelectedModel(latestDef.model)

        // Reverse-map: find which KBs are configured on this agent
        const tools = latestDef.tools || []
        const matchedKBs = new Set<string>()

        // Check MCP tools — extract KB name from server_url or server_label
        const mcpTools = tools.filter((t: any) => t.type === 'mcp')
        for (const mcp of mcpTools) {
          // Try extracting from server_url first
          const serverUrl = mcp.server_url || ''
          const urlMatch = serverUrl.match(/\/knowledgebases\/([^/]+)\/mcp/)
          if (urlMatch) {
            matchedKBs.add(urlMatch[1])
            continue
          }
          // Fallback: extract from server_label (format: kb_{name})
          const label = mcp.server_label || ''
          if (label.startsWith('kb_')) {
            matchedKBs.add(label.replace(/^kb_/, '').replace(/_/g, ''))
          }
        }

        // Check function tools (current architecture) — KB names in enum
        const funcTools = tools.filter(
          (t: any) => t.type === 'function' && (t.name === 'knowledge_base_retrieve' || t.function?.name === 'knowledge_base_retrieve')
        )
        for (const ft of funcTools) {
          // Handle both top-level and nested function structures
          const params = ft.parameters || ft.function?.parameters
          const kbEnum = params?.properties?.knowledge_base?.enum
          if (Array.isArray(kbEnum)) {
            for (const kb of kbEnum) matchedKBs.add(kb)
          }
        }

        if (matchedKBs.size > 0) {
          setSelectedKnowledgeBases(matchedKBs)
          setHasKnowledgeTools(true)
        }

        // Restore optional tool toggles
        if (tools.length > 0) {
          setEnabledTools({
            codeInterpreter: tools.some((t: any) => t.type === 'code_interpreter'),
            fileSearch: tools.some((t: any) => t.type === 'file_search'),
            webSearch: tools.some((t: any) => t.type === 'bing_grounding'),
            airportOps: tools.some((t: any) => t.type === 'mcp' && t.server_label === 'airport_ops'),
          })
        }

        setAgentNameSaved(agent.name)

        // Load stored starter questions
        try {
          const stored = JSON.parse(localStorage.getItem('agentStarterQuestions') || '{}')
          if (stored[agent.name] && Array.isArray(stored[agent.name])) {
            setStarterQuestions(stored[agent.name])
          }
        } catch {}
      } else {
        // Fallback: try loading as classic assistant
        console.warn('Agent not found in v2 API, trying classic...')
        await loadExistingAssistantDetailsClassic()
      }
    } catch (err) {
      console.error('Error loading existing agent details:', err)
    }
  }

  /** Fallback: load classic assistant details (for backward compat) */
  const loadExistingAssistantDetailsClassic = async () => {
    if (!existingAssistantId) return

    try {
      const response = await fetch(`/api/foundry/assistants/${existingAssistantId}`)
      if (response.ok) {
        const assistant = await response.json()
        console.log('Loaded classic assistant (fallback):', assistant)

        if (assistant.name) setAgentName(assistant.name)
        if (assistant.instructions) setAgentInstructions(assistant.instructions)
        if (assistant.model) setSelectedModel(assistant.model)
      }
    } catch (err) {
      console.error('Error loading classic assistant:', err)
    }
  }

  const loadKnowledgeBases = async () => {
    try {
      setLoading(true)
      // Fetch knowledge bases and knowledge sources in parallel
      const [kbData, ksData] = await Promise.all([
        fetchKnowledgeBases(),
        fetchKnowledgeSources()
      ])
      setKnowledgeBases(kbData.value || [])
      // Build a Map of source name → full source details (includes kind, createdResources, etc.)
      const srcMap = new Map<string, KnowledgeSource>()
      for (const src of (ksData.value || [])) {
        srcMap.set(src.name, src)
      }
      setKnowledgeSourcesMap(srcMap)
      // Start with no knowledge bases selected by default
      setSelectedKnowledgeBases(new Set())
    } catch (err) {
      console.error('Failed to load knowledge bases:', err)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Get the list of selected knowledge base names.
   * With the v2 API and MCP tools, we pass KB names directly to the server
   * which builds the MCP tool definitions. No more resolving to search indexes!
   */
  const getSelectedKBNames = (): string[] => {
    return Array.from(selectedKnowledgeBases)
  }

  const handleKnowledgeBaseToggle = (baseName: string) => {
    setSelectedKnowledgeBases(prev => {
      const newSet = new Set(prev)
      if (newSet.has(baseName)) {
        newSet.delete(baseName)
      } else {
        newSet.add(baseName)
      }
      return newSet
    })
    // Reset runtime source params so they re-initialize with the new KB set
    setRuntimeSettings(prev => ({ ...prev, knowledgeSourceParams: [] }))
    setSettingsDirty(true)
  }

  const handleCreateNewKnowledgeBase = () => {
    const currentUrl = window.location.pathname + window.location.search
    router.push(`/knowledge-sources/quick-create?returnUrl=${encodeURIComponent(currentUrl)}`)
  }

  const handleGenerateStarters = async () => {
    if (!agentInstructions.trim()) return
    setGeneratingStarters(true)
    try {
      const response = await fetch('/api/foundry/generate-starters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemMessage: agentInstructions,
          model: selectedModel,
        }),
      })
      if (response.ok) {
        const data = await response.json()
        if (data.starters && data.starters.length > 0) {
          setStarterQuestions(data.starters)
        }
      } else {
        console.error('Failed to generate starters:', await response.text())
      }
    } catch (err) {
      console.error('Error generating starters:', err)
    } finally {
      setGeneratingStarters(false)
    }
  }

  const handleSaveAgent = async () => {
    setSaving(true)
    try {
      // Build optional tools array (MCP tools are built server-side from KB names)
      const tools: any[] = []
      if (enabledTools.codeInterpreter) tools.push({ type: 'code_interpreter' })
      if (enabledTools.fileSearch) tools.push({ type: 'file_search' })
      if (enabledTools.airportOps) tools.push({
        type: 'mcp',
        server_label: 'airport_ops',
        server_url: 'https://ca-pizza-mcp-onlgvc76rbuge.jollymushroom-1f42138d.swedencentral.azurecontainerapps.io/mcp',
        require_approval: 'never',
        project_connection_id: 'airport-ops-mcp',
      })

      // Create the agent via v2 API
      // Server handles building MCP tool definitions from knowledgeBases list
      const agentData = {
        name: agentName,
        model: selectedModel,
        instructions: agentInstructions,
        knowledgeBases: getSelectedKBNames(),
        tools: tools.length > 0 ? tools : undefined,
      }

      console.log('Creating agent (v2) with data:', agentData)
      const agent = await createFoundryAgentV2(agentData)
      console.log('Created agent (v2):', agent)

      // Store starter questions in localStorage for this agent
      if (starterQuestions.length > 0) {
        try {
          const stored = JSON.parse(localStorage.getItem('agentStarterQuestions') || '{}')
          stored[agent.name] = starterQuestions
          localStorage.setItem('agentStarterQuestions', JSON.stringify(stored))
        } catch {}
      }

      setAgentNameSaved(agent.name)
      setHasKnowledgeTools(getSelectedKBNames().length > 0)

      // Create a conversation automatically
      const conv = await createConversation()
      setConversationId(conv.id)

      // Add to conversations list
      setConversations([{
        id: conv.id,
        created_at: new Date().toISOString(),
        messages: []
      }])

      console.log('Agent created successfully:', { agentName: agent.name, conversationId: conv.id })

      // Automatically transition to playground mode
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.set('assistantId', agent.name)
      newUrl.searchParams.set('mode', 'playground')
      window.history.replaceState({}, '', newUrl.toString())

    } catch (err) {
      console.error('Failed to create agent:', err)
      alert(`Failed to create agent: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleCreateNewConversation = async () => {
    try {
      const conv = await createConversation()
      setConversations(prev => [{
        id: conv.id,
        created_at: new Date().toISOString(),
        messages: []
      }, ...prev])
      switchToConversation(conv.id)
    } catch (err) {
      console.error('Failed to create new conversation:', err)
    }
  }

  /**
   * Export chat as JSONL dataset for evaluation.
   * Per MS Learn, the dataset schema for evaluations is:
   *   { query, response, context, ground_truth }
   * - query: the user's question
   * - response: the agent's answer
   * - context: source snippets the agent used (extracted from MCP/KB sources)
   * - ground_truth: left empty — requires human annotation
   * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation#dataset-evaluation
   */
  const exportChatAsJsonl = () => {
    const lines: string[] = []
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role !== 'user') continue
      // Find the next assistant message
      const nextMsg = messages[i + 1]
      if (!nextMsg || nextMsg.role !== 'assistant') continue

      const query = typeof msg.content === 'string' ? msg.content : ''
      const response = typeof nextMsg.content === 'string' ? nextMsg.content : ''

      // Extract context from references (source snippets the agent grounded on)
      let context = ''
      if (nextMsg.references && nextMsg.references.length > 0) {
        context = nextMsg.references
          .filter((ref: any) => ref.sourceData?.snippet || ref.sourceData?.content)
          .map((ref: any) => {
            const title = ref.sourceData?.title || ref.docKey || 'Source'
            const snippet = ref.sourceData?.snippet || ref.sourceData?.content || ''
            return `[${title}]: ${snippet}`
          })
          .slice(0, 5) // Top 5 sources
          .join('\n')
      }

      lines.push(JSON.stringify({
        query,
        response,
        context: context || '',
        ground_truth: '', // Requires human annotation
      }))
    }

    if (lines.length === 0) {
      alert('No user-assistant message pairs found to export.')
      return
    }

    const blob = new Blob([lines.join('\n')], { type: 'application/jsonl' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conversation-${conversationId?.slice(-8) || 'export'}-dataset.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Export chat as a prettified Markdown file.
   */
  const exportChatAsMarkdown = () => {
    const lines: string[] = [
      `# Conversation Export`,
      ``,
      `**Agent:** ${agentName_saved || 'Unknown'}`,
      `**Date:** ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      `**Conversation ID:** ${conversationId || 'N/A'}`,
      ``,
      `---`,
      ``,
    ]

    for (const msg of messages) {
      if (msg.role === 'user') {
        lines.push(`## 👤 User`)
        lines.push(``)
        lines.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
        lines.push(``)
      } else if (msg.role === 'assistant') {
        lines.push(`## 🤖 Assistant`)
        lines.push(``)
        lines.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
        if (msg.references && msg.references.length > 0) {
          lines.push(``)
          lines.push(`### Sources (${msg.references.length})`)
          for (const ref of msg.references as any[]) {
            const title = ref.sourceData?.title || ref.docKey || 'Source'
            const url = ref.url || ref.blobUrl || ref.webUrl || ''
            lines.push(`- **${title}**${url ? ` — [link](${url})` : ''}`)
          }
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          lines.push(``)
          lines.push(`### Tools Used`)
          for (const tc of msg.toolCalls) {
            lines.push(`- \`${tc.name || tc.type}\`${tc.server_label ? ` (${tc.server_label})` : ''}`)
          }
        }
        lines.push(``)
        lines.push(`---`)
        lines.push(``)
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conversation-${conversationId?.slice(-8) || 'export'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const switchToConversation = (newConversationId: string) => {
    setConversationId(newConversationId)
    setMessages([])
    setCurrentMessage('')
    setIsRunning(false)
  }

  const deleteConversation = async (convIdToDelete: string) => {
    // Remove from local state
    setConversations(prev => prev.filter(c => c.id !== convIdToDelete))

    if (conversationId === convIdToDelete) {
      const remaining = conversations.filter(c => c.id !== convIdToDelete)
      if (remaining.length > 0) {
        switchToConversation(remaining[0].id)
      } else {
        setConversationId(null)
        setMessages([])
      }
    }
  }

  const sendMessage = async () => {
    if (!currentMessage.trim() || !agentName_saved || !conversationId || isRunning) return

    setIsRunning(true)
    const userMessage = currentMessage.trim()
    setCurrentMessage('')

    // Add user message to display
    const newUserMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, newUserMessage])

    try {
      // Ensure the agent has the latest settings before sending
      if (settingsDirty) {
        await updateAgentDetails()
        setSettingsDirty(false)
      }

      // Send message and get response — SYNCHRONOUS, no polling needed!
      // Include knowledge source runtime params if configured
      const cleanedParams = runtimeSettings.knowledgeSourceParams
        .filter(p => p.knowledgeSourceName)
        .map(p => {
          const cleaned: any = { knowledgeSourceName: p.knowledgeSourceName }
          if (p.alwaysQuerySource === true) cleaned.alwaysQuerySource = true
          cleaned.includeReferences = p.includeReferences !== false
          cleaned.includeReferenceSourceData = p.includeReferenceSourceData !== false
          if (typeof p.rerankerThreshold === 'number') cleaned.rerankerThreshold = p.rerankerThreshold
          if (p.headers && Object.keys(p.headers).length > 0) cleaned.headers = p.headers
          return cleaned
        })

      const responseData = await sendAgentResponse({
        conversationId,
        agentName: agentName_saved,
        input: userMessage,
        knowledgeSourceParams: cleanedParams.length > 0 ? cleanedParams : undefined,
      })

      console.log('[v2] Response received:', {
        id: responseData.id,
        status: responseData.status,
        outputCount: responseData.output?.length || 0,
      })

      // Extract the assistant message and references from the response output
      const { text, references, mcpCalls, activity, codeBlocks, generatedFiles } = extractResponseContent(responseData)

      const msgId = `msg-${Date.now()}`
      setMessages(prev => [...prev, {
        id: msgId,
        role: 'assistant',
        content: text,
        timestamp: new Date().toISOString(),
        toolCalls: mcpCalls,
        responseId: responseData.id,
        references,
        activity,
        codeBlocks,
        generatedFiles,
      }])

    } catch (err) {
      console.error('Failed to send message:', err)
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err.message}`,
        timestamp: new Date().toISOString()
      }])
    } finally {
      setIsRunning(false)
    }
  }

  /**
   * Extract text content, references, and tool calls from a v2 response.
   *
   * The response.output array may contain:
   * - { type: "function_call", name: "knowledge_base_retrieve", ... } — KB retrieval invocation
   * - { type: "function_call_output", output: "...", _rawRetrieval: {...} } — KB retrieval results
   * - { type: "code_interpreter_call", id, container_id, code, outputs, status } — Code Interpreter
   * - { type: "mcp_call", ... } — MCP tool invocation (legacy, kept for backward compat)
   * - { type: "mcp_call_output", output: "..." } — MCP tool result
   * - { type: "message", role: "assistant", content: [{ type: "output_text", text: "...", annotations }] }
   */
  const extractResponseContent = (responseData: any): {
    text: string
    references: KnowledgeBaseReference[]
    mcpCalls: any[]
    activity: KnowledgeBaseActivityRecord[]
    codeBlocks: Array<{ id: string; code: string; containerId?: string; status?: string }>
    generatedFiles: Array<{ containerId: string; fileId: string; filename: string; startIndex?: number; endIndex?: number }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    mcpRetrievalMeta?: any
  } => {
    const output = responseData.output || []
    let text = ''
    const references: KnowledgeBaseReference[] = []
    const mcpCalls: any[] = []
    const activity: KnowledgeBaseActivityRecord[] = []
    const codeBlocks: Array<{ id: string; code: string; containerId?: string; status?: string }> = []
    const generatedFiles: Array<{ containerId: string; fileId: string; filename: string; startIndex?: number; endIndex?: number }> = []
    let mcpRetrievalMeta: any = null

    for (const item of output) {
      if (item.type === 'message' && item.role === 'assistant') {
        // Extract text from message content
        for (const content of (item.content || [])) {
          if (content.type === 'output_text') {
            text += content.text || ''
          }
        }

        // Extract annotations/citations from message content
        for (const content of (item.content || [])) {
          const annotations = content.annotations || []
          for (const ann of annotations) {
            const refIdx = references.length
            if (ann.type === 'url_citation' && ann.url_citation) {
              references.push({
                type: 'web',
                id: String(refIdx),
                activitySource: 0,
                url: ann.url_citation.url || '',
                title: ann.url_citation.title || ann.url_citation.url || '',
                sourceData: { title: ann.url_citation.title, content: '' }
              } as any)
            } else if (ann.type === 'file_citation' && ann.file_citation) {
              references.push({
                type: 'searchIndex',
                id: String(refIdx),
                activitySource: 0,
                docKey: ann.file_citation.file_id || '',
                sourceData: { title: ann.file_citation.quote || 'Document', content: ann.file_citation.quote || '' }
              } as any)
            } else if (ann.type === 'container_file_citation') {
              // Code Interpreter generated file reference
              const containerId = ann.container_id || ''
              const fileId = ann.file_id || ''
              const filename = ann.filename || fileId
              if (containerId && fileId) {
                generatedFiles.push({
                  containerId,
                  fileId,
                  filename,
                  startIndex: ann.start_index,
                  endIndex: ann.end_index,
                })
              }
            }
          }
        }
      } else if (item.type === 'code_interpreter_call') {
        // Code Interpreter tool call — extract the Python code that was executed
        codeBlocks.push({
          id: item.id || `ci-${Date.now()}`,
          code: item.code || '',
          containerId: item.container_id,
          status: item.status,
        })
        mcpCalls.push({
          type: 'code_interpreter',
          name: 'Code Interpreter',
          server_label: 'Python sandbox',
          arguments: { code: item.code },
        })
      } else if (item.type === 'function_call' && item.name === 'knowledge_base_retrieve') {
        // Function-tool KB retrieval call (current approach)
        let args: any = {}
        try {
          args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : (item.arguments || {})
        } catch { /* ignore */ }
        mcpCalls.push({
          type: 'function',
          name: 'knowledge_base_retrieve',
          server_label: args.knowledge_base || '',
          arguments: args,
        })
      } else if (item.type === 'function_call_output') {
        // Function-tool KB retrieval results — extract references from _rawRetrieval
        const rawRetrieval = item._rawRetrieval
        if (rawRetrieval?.references) {
          for (const ref of rawRetrieval.references) {
            // Spread the raw reference to preserve type-specific fields
            // like blobUrl, webUrl, docUrl that the sources-panel needs
            references.push({
              ...ref,
              id: String(references.length),
              activitySource: ref.activitySource ?? 0,
            } as any)
          }
        }
        // Also extract activity records for retrieval journey display
        if (rawRetrieval?.activity) {
          activity.push(...rawRetrieval.activity)
        }
      } else if (item.type === 'mcp_list_tools') {
        // MCP tool discovery step — Foundry runtime enumerating available tools
        // No action needed, this is informational
      } else if (item.type === 'mcp_approval_request') {
        // MCP approval request — shouldn't happen when require_approval is 'never'
        // No action needed
      } else if (item.type === 'mcp_call') {
        // MCP tool call — Foundry-native KB retrieval or external MCP (airport-ops)
        // For KB MCP calls, the backend attaches _mcpSources with parsed references
        // Ref: https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/foundry-iq-connect
        mcpCalls.push({
          type: 'mcp',
          name: item.name || 'mcp_tool',
          server_label: item.server_label || '',
          arguments: item.arguments,
        })

        // Extract KB sources from MCP call if backend parsed them
        if (item._mcpSources && Array.isArray(item._mcpSources)) {
          for (const src of item._mcpSources) {
            references.push({
              type: src.type || 'azureBlob',
              id: String(references.length),
              activitySource: 0,
              docKey: src.docKey || '',
              blobUrl: src.blobUrl || '',
              url: src.url || src.blobUrl || '',
              sourceData: src.sourceData || { title: 'Source', snippet: '' },
            } as any)
          }
        }

        // Extract retrieval metadata and build synthetic activity entries
        // for the Retrieval Journey component (query decomposition, doc count).
        // The MCP path doesn't return the full activity array (modelQueryPlanning,
        // per-source timing, agenticReasoning, modelAnswerSynthesis) — only the
        // query decomposition and doc count are available.
        if (item._mcpRetrievalMeta) {
          const meta = item._mcpRetrievalMeta
          mcpRetrievalMeta = meta

          // Synthetic activity: query planning with tokens and timing
          if (meta.queries && meta.queries.length > 0) {
            activity.push({
              type: 'modelQueryPlanning',
              id: activity.length,
              inputTokens: meta.usage?.prompt_tokens || 0,
              outputTokens: meta.usage?.completion_tokens || 0,
              elapsedMs: meta.elapsedMs || 0,
            } as any)

            // One searchIndex entry per sub-query so each appears in the journey
            const docsPerQuery = meta.documentCount
              ? Math.ceil(meta.documentCount / meta.queries.length)
              : 0
            const timePerQuery = meta.elapsedMs
              ? Math.round(meta.elapsedMs / meta.queries.length)
              : 0
            for (const query of meta.queries) {
              activity.push({
                type: 'searchIndex',
                id: activity.length,
                knowledgeSourceName: meta.serverLabel || 'Knowledge Base',
                count: docsPerQuery,
                elapsedMs: timePerQuery,
                searchIndexArguments: { search: query },
              } as any)
            }

            // Synthetic reasoning step with total token usage
            if (meta.usage) {
              activity.push({
                type: 'agenticReasoning',
                id: activity.length,
                reasoningTokens: meta.usage.total_tokens || 0,
                retrievalReasoningEffort: { kind: 'mcp' },
                elapsedMs: meta.elapsedMs || 0,
              } as any)
            }
          }
        }
      } else if (item.type === 'mcp_call_output') {
        // MCP tool results (remote MCP servers or legacy KB MCP)
        try {
          const mcpOutput = typeof item.output === 'string' ? JSON.parse(item.output) : item.output
          if (mcpOutput?.references) {
            for (const ref of mcpOutput.references) {
              references.push({
                type: ref.type || 'searchIndex',
                id: String(references.length),
                activitySource: 0,
                docKey: ref.docKey || ref.id || '',
                url: ref.url || '',
                title: ref.title || '',
                sourceData: ref.sourceData || { title: ref.title, content: ref.content || '' }
              } as any)
            }
          }
        } catch {
          // MCP output may not be JSON (e.g. raw tool output from airport-ops) — that's fine
        }
      }
    }

    if (!text) {
      text = 'No response content received.'
    }

    return { text, references, mcpCalls, activity, codeBlocks, generatedFiles, usage: responseData.usage, mcpRetrievalMeta }
  }

  const updateAgentDetails = async (): Promise<boolean> => {
    if (!agentName_saved) return false

    try {
      // Build optional tools array
      const tools: any[] = []
      if (enabledTools.codeInterpreter) tools.push({ type: 'code_interpreter' })
      if (enabledTools.fileSearch) tools.push({ type: 'file_search' })
      if (enabledTools.airportOps) tools.push({
        type: 'mcp',
        server_label: 'airport_ops',
        server_url: 'https://ca-pizza-mcp-onlgvc76rbuge.jollymushroom-1f42138d.swedencentral.azurecontainerapps.io/mcp',
        require_approval: 'never',
        project_connection_id: 'airport-ops-mcp',
      })

      const kbNames = getSelectedKBNames()
      setHasKnowledgeTools(kbNames.length > 0)

      const response = await fetch(`/api/foundry/agents/${encodeURIComponent(agentName_saved)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          instructions: agentInstructions,
          knowledgeBases: kbNames,
          tools: tools.length > 0 ? tools : undefined,
        })
      })

      if (response.ok) {
        console.log('Agent details updated successfully (v2)')
        // Persist starter questions
        if (starterQuestions.length > 0) {
          try {
            const stored = JSON.parse(localStorage.getItem('agentStarterQuestions') || '{}')
            stored[agentName_saved] = starterQuestions
            localStorage.setItem('agentStarterQuestions', JSON.stringify(stored))
          } catch {}
        }
        return true
      } else {
        const errData = await response.json().catch(() => ({}))
        console.error('Failed to update agent details:', errData)
        return false
      }
    } catch (err) {
      console.error('Error updating agent details:', err)
      return false
    }
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    setSaveStatus('idle')
    try {
      const success = await updateAgentDetails()
      if (success) {
        setSettingsDirty(false)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus('idle'), 4000)
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 4000)
    } finally {
      setSavingSettings(false)
    }
  }

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'model':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-4">Model Configuration</h2>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
              >
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4.1">GPT-4.1 (Recommended)</SelectItem>
                  <SelectItem value="gpt-4.1-mini">GPT-4.1 Mini</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-5">GPT-5 (Code Interpreter &amp; File Search only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )

      case 'tools':
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold mb-4">Tools</h2>
            <div className="space-y-3 max-w-2xl\">
              <label className="flex items-start gap-3 p-4 border border-stroke-card rounded-lg cursor-pointer hover:bg-bg-tertiary\">
                <input
                  type="checkbox"
                  checked={enabledTools.codeInterpreter}
                  onChange={(e) => setEnabledTools({...enabledTools, codeInterpreter: e.target.checked})}
                  className="mt-0.5 h-4 w-4\"
                />
                <div className="flex-1\">
                  <div className="font-medium\">Code Interpreter</div>
                  <div className="text-sm text-fg-muted mt-1\">Execute Python code in a Jupyter notebook environment</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 border border-stroke-card rounded-lg cursor-pointer hover:bg-bg-tertiary\">
                <input
                  type="checkbox"
                  checked={enabledTools.airportOps}
                  onChange={(e) => setEnabledTools({...enabledTools, airportOps: e.target.checked})}
                  className="mt-0.5 h-4 w-4\"
                />
                <div className="flex-1\">
                  <div className="flex items-center gap-2\">
                    <div className="font-medium\">Airport Operations (MCP)</div>
                    <Airplane20Regular className="text-fg-muted\" />
                  </div>
                  <div className="text-sm text-fg-muted mt-1\">
                    Connect to the Airport Operations MCP server for real-time KPIs, flight data, delays, passenger stats, and more (40 tools)
                  </div>
                  <div className="text-xs text-fg-muted mt-1 font-mono opacity-60\">
                    Remote MCP &middot; Streamable HTTP &middot; airport-ops-mcp
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 border border-stroke-card rounded-lg opacity-40 cursor-not-allowed\">
                <input type="checkbox" checked={false} disabled className="mt-0.5 h-4 w-4\" />
                <div className="flex-1\">
                  <div className="font-medium\">File Search</div>
                  <div className="text-sm text-fg-muted mt-1\">Search through uploaded files and documents</div>
                  <div className="text-[10px] text-fg-subtle mt-1\">Not available in this demo</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 border border-stroke-card rounded-lg opacity-40 cursor-not-allowed\">
                <input type="checkbox" checked={false} disabled className="mt-0.5 h-4 w-4\" />
                <div className="flex-1\">
                  <div className="font-medium\">Web Search</div>
                  <div className="text-sm text-fg-muted mt-1\">Search the web for real-time information</div>
                  <div className="text-[10px] text-fg-subtle mt-1\">Not available in this demo</div>
                </div>
              </label>
            </div>
          </div>
        )

      case 'instructions':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Instructions</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowInstructionsModal(true)}
                className="gap-1.5"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                Expand
              </Button>
            </div>
            <Card className="p-6 max-w-4xl">
              <Textarea
                value={agentInstructions}
                onChange={(e) => setAgentInstructions(e.target.value)}
                placeholder="Describe what this agent should do..."
                className="min-h-64 font-mono text-sm"
              />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-fg-muted">
                  {agentInstructions.length} characters
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleGenerateStarters}
                    disabled={generatingStarters || !agentInstructions.trim()}
                    className="gap-1.5"
                  >
                    {generatingStarters ? (
                      <>
                        <div className="animate-spin h-3 w-3 border-2 border-fg-muted border-t-transparent rounded-full" />
                        Generating...
                      </>
                    ) : (
                      '✨ Generate starter questions'
                    )}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAgentInstructions('')}>Clear</Button>
                </div>
              </div>
            </Card>

            {/* Starter Questions Editor */}
            {starterQuestions.length > 0 && (
              <Card className="p-6 max-w-4xl">
                <h3 className="text-sm font-semibold mb-3">Conversation Starters</h3>
                <p className="text-xs text-fg-muted mb-4">These questions will appear when a new conversation starts. Click to edit.</p>
                <div className="space-y-2">
                  {starterQuestions.map((q, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-fg-muted w-4 text-center flex-shrink-0">{i + 1}</span>
                      <input
                        type="text"
                        value={q}
                        onChange={(e) => {
                          const updated = [...starterQuestions]
                          updated[i] = e.target.value
                          setStarterQuestions(updated)
                        }}
                        className="flex-1 text-sm px-3 py-2 border border-stroke-card rounded-lg bg-bg-primary focus:outline-none focus:ring-2 focus:ring-stroke-focus"
                      />
                      <button
                        onClick={() => setStarterQuestions(starterQuestions.filter((_, idx) => idx !== i))}
                        className="p-1 text-fg-muted hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                        title="Remove question"
                      >
                        <Dismiss20Regular className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleGenerateStarters}
                    disabled={generatingStarters}
                    className="text-xs"
                  >
                    ↻ Regenerate
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )

      case 'knowledge':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Knowledge</h2>
              <p className="text-sm text-fg-muted mt-1">Connect knowledge bases to ground your agent</p>
            </div>

            <div className="max-w-4xl space-y-4">
              {loading ? (
                <LoadingSkeleton className="h-12" />
              ) : (
                <>
                  {/* Dropdown for adding knowledge bases */}
                  <div className="relative">
                    <select
                      className="w-full p-3 pr-10 border border-stroke-card rounded-lg bg-bg-primary text-fg-primary appearance-none cursor-pointer hover:border-stroke-accent focus:outline-none focus:ring-2 focus:ring-stroke-focus"
                      onChange={(e) => {
                        const value = e.target.value
                        if (value === 'create-new') {
                          handleCreateNewKnowledgeBase()
                        } else if (value && value !== '') {
                          // Single-select: replace current KB instead of adding
                          setSelectedKnowledgeBases(new Set([value]))
                        }
                        // Reset dropdown to placeholder
                        setTimeout(() => {
                          e.target.value = ''
                        }, 100)
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {selectedKnowledgeBases.size > 0 ? 'Change knowledge base' : '+ Select knowledge base'}
                      </option>
                      {knowledgeBases
                        .filter(base => !selectedKnowledgeBases.has(base.name))
                        .map((base) => (
                          <option
                            key={base.name}
                            value={base.name}
                          >
                            {base.name}
                          </option>
                        ))}
                      {knowledgeBases.length > 0 && (
                        <>
                          <option value="" disabled>──────────</option>
                          <option value="create-new">
                            + Create new knowledge base
                          </option>
                        </>
                      )}
                      {knowledgeBases.length === 0 && (
                        <option value="create-new">
                          + Create new knowledge base
                        </option>
                      )}
                    </select>
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                      <svg className="h-5 w-5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Selected knowledge bases */}
                  {selectedKnowledgeBases.size > 0 ? (
                    <div className="space-y-2">
                      {Array.from(selectedKnowledgeBases).map((baseName) => {
                        const base = knowledgeBases.find(b => b.name === baseName)
                        if (!base) return null

                        const sourceCount = base.knowledgeSources?.length || 0
                        // Look up source kinds from the enriched knowledgeSourcesMap
                        const sourceTypes = base.knowledgeSources?.map(ks => {
                          const srcDetail = knowledgeSourcesMap.get(ks.name)
                          return srcDetail?.kind || 'unknown'
                        }).filter((v, i, a) => a.indexOf(v) === i) || []
                        // Check if this KB has any indexed sources
                        const hasIndexedSource = true // MCP tools handle all source types

                        return (
                          <div
                            key={base.name}
                            className="flex items-center gap-3 p-4 border border-stroke-card rounded-lg bg-bg-secondary"
                          >
                            <CheckmarkCircle20Filled className="h-5 w-5 text-fg-accent flex-shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{base.name}</span>
                              </div>
                              <p className="text-sm text-fg-muted">
                                Knowledge Base • {sourceCount} source{sourceCount !== 1 ? 's' : ''}
                                {sourceTypes.length > 0 && ` • ${sourceTypes.join(', ')}`}
                              </p>
                              {!hasIndexedSource && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                  ⚠ No knowledge sources found in this KB
                                </p>
                              )}
                              {base.description && (
                                <p className="text-xs text-fg-muted mt-1">{base.description}</p>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => console.log('Settings', base.name)}
                              >
                                <Settings20Regular className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleKnowledgeBaseToggle(base.name)}
                              >
                                <Dismiss20Regular className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 border border-stroke-card rounded-lg bg-bg-secondary">
                      <Database20Regular className="h-10 w-10 mx-auto text-fg-muted mb-3" />
                      <p className="text-sm text-fg-muted">No knowledge bases connected</p>
                      <p className="text-xs text-fg-muted mt-1">Use the dropdown above to add knowledge bases</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )
    }
  }

  // Show chat interface if agent is created
  if (agentName_saved) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] bg-bg-primary">
        {/* Left Panel - Agent Info & Conversations (Admin only) */}
        {isAdmin && (
        <div className="w-80 bg-bg-secondary border-r border-stroke-divider flex flex-col">
          <div className="p-4 border-b border-stroke-divider">
            <input
              value={agentName}
              onChange={(e) => { setAgentName(e.target.value); setSettingsDirty(true) }}
              className="text-lg font-semibold bg-transparent border-0 focus:ring-1 focus:ring-stroke-focus rounded px-1 w-full"
              placeholder="Agent name"
            />
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fg-muted">Agent:</span>
                <code className="text-xs bg-bg-tertiary px-2 py-0.5 rounded font-mono">{agentName_saved}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fg-muted">Conversation:</span>
                <code className="text-xs bg-bg-tertiary px-2 py-0.5 rounded font-mono">{conversationId ? conversationId.slice(-12) : 'none'}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fg-muted">API:</span>
                <span className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">v2 (MCP)</span>
              </div>
            </div>
          </div>

          {/* Conversation Management */}
          <div className="p-4 border-b border-stroke-divider">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Conversations</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCreateNewConversation}
                className="gap-1"
              >
                <Add20Regular className="h-4 w-4" />
                New
              </Button>
            </div>

            <div className="space-y-1 max-h-48 overflow-auto">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded text-xs cursor-pointer hover:bg-bg-hover",
                    conv.id === conversationId ? "bg-bg-accent-subtle text-fg-accent" : ""
                  )}
                  onClick={() => switchToConversation(conv.id)}
                >
                  <History20Regular className="h-3 w-3 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">
                      Conv {conv.id.slice(-8)}
                    </div>
                    <div className="text-fg-muted">
                      {new Date(conv.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(conv.id)
                    }}
                    className="opacity-0 group-hover:opacity-100"
                  >
                    <Delete20Regular className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              {conversations.length === 0 && (
                <div className="text-xs text-fg-muted text-center py-4">
                  No conversations yet
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 p-4 space-y-4 overflow-auto">
            <div>
              <h3 className="text-sm font-semibold mb-2">Knowledge Bases</h3>
              <div className="space-y-2">
                {/* KB dropdown — hidden when a KB is already selected */}
                {selectedKnowledgeBases.size === 0 && (
                <div className="relative">
                  <select
                    className="w-full text-xs p-2 pr-8 border border-stroke-card rounded bg-bg-tertiary text-fg-primary appearance-none cursor-pointer hover:border-stroke-accent focus:outline-none focus:ring-1 focus:ring-stroke-focus"
                    onChange={(e) => {
                      const value = e.target.value
                      if (value && value !== '') {
                        setSelectedKnowledgeBases(new Set([value]))
                      }
                      setTimeout(() => {
                        e.target.value = ''
                      }, 100)
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      + Select knowledge base
                    </option>
                    {knowledgeBases
                      .filter(base => !selectedKnowledgeBases.has(base.name))
                      .map((base) => (
                        <option
                          key={base.name}
                          value={base.name}
                        >
                          {base.name}
                        </option>
                      ))}
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                    <svg className="h-3 w-3 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                )}

                {/* Selected knowledge base — single select with Change button */}
                {selectedKnowledgeBases.size > 0 ? (
                  <>
                    {Array.from(selectedKnowledgeBases).slice(0, 1).map(baseName => (
                      <div key={baseName} className="flex items-center justify-between text-xs p-2 bg-bg-tertiary rounded">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{baseName}</div>
                          <div className="text-fg-muted">MCP Tool: kb_{baseName.replace(/[^a-zA-Z0-9_]/g, '_')}</div>
                        </div>
                        <button
                          onClick={() => setSelectedKnowledgeBases(new Set())}
                          className="ml-2 px-2 py-1 text-[10px] rounded bg-bg-secondary hover:bg-bg-hover text-fg-muted hover:text-fg-default border border-stroke-card"
                          title="Change knowledge base"
                        >
                          Change
                        </button>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-xs text-fg-muted text-center py-2">
                    No knowledge base selected
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Tools</h3>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs p-2 bg-bg-tertiary rounded cursor-pointer hover:bg-bg-hover">
                  <input
                    type="checkbox"
                    checked={enabledTools.codeInterpreter}
                    onChange={(e) => { setEnabledTools({...enabledTools, codeInterpreter: e.target.checked}); setSettingsDirty(true) }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-medium">Code Interpreter</span>
                </label>
                <label className="flex items-center gap-2 text-xs p-2 bg-bg-tertiary rounded cursor-pointer hover:bg-bg-hover">
                  <input
                    type="checkbox"
                    checked={enabledTools.airportOps}
                    onChange={(e) => { setEnabledTools({...enabledTools, airportOps: e.target.checked}); setSettingsDirty(true) }}
                    className="h-3.5 w-3.5"
                  />
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">Airport Ops (MCP)</span>
                    <Airplane20Regular className="h-3 w-3 text-fg-muted" />
                  </div>
                </label>
                <label className="flex items-center gap-2 text-xs p-2 bg-bg-tertiary rounded opacity-40 cursor-not-allowed">
                  <input type="checkbox" checked={false} disabled className="h-3.5 w-3.5" />
                  <span className="font-medium">File Search</span>
                  <span className="text-[9px] text-fg-subtle">N/A</span>
                </label>
                <label className="flex items-center gap-2 text-xs p-2 bg-bg-tertiary rounded opacity-40 cursor-not-allowed">
                  <input type="checkbox" checked={false} disabled className="h-3.5 w-3.5" />
                  <span className="font-medium">Web Search</span>
                  <span className="text-[9px] text-fg-subtle">N/A</span>
                </label>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Model</h3>
              <p className="text-xs text-fg-muted">{selectedModel}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">System Instructions</h3>
                <button
                  onClick={() => setShowInstructionsModal(true)}
                  className="p-1 hover:bg-bg-hover rounded text-fg-muted hover:text-fg-default transition-colors"
                  title="Expand editor"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                </button>
              </div>
              <div className="space-y-2">
                <textarea
                  value={agentInstructions}
                  onChange={(e) => { setAgentInstructions(e.target.value); setSettingsDirty(true) }}
                  placeholder="Enter system instructions..."
                  className="w-full text-xs p-2 bg-bg-tertiary rounded resize-none border-0 focus:ring-1 focus:ring-stroke-focus"
                  rows={4}
                />
                <p className="text-xs text-fg-muted">
                  {agentInstructions.length} characters
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-stroke-divider space-y-2">
            <Button
              className="w-full"
              onClick={handleSaveSettings}
              disabled={savingSettings}
            >
              {savingSettings
                ? 'Saving...'
                : saveStatus === 'saved'
                ? '\u2713 Saved to Foundry'
                : saveStatus === 'error'
                ? '\u2717 Save Failed \u2014 Retry'
                : settingsDirty
                ? 'Save Settings \u2022'
                : 'Save Settings'}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                // Auto-save unsaved changes before navigating away
                if (settingsDirty) await updateAgentDetails()

                if (mode === 'playground') {
                  router.push('/agents')
                } else {
                  setAgentNameSaved(null)
                  setConversationId(null)
                  setMessages([])
                  setConversations([])
                }
              }}
            >
              {mode === 'playground' ? 'Back to Agents' : 'Back to Builder'}
            </Button>
          </div>
        </div>
        )}

        {/* Chat Interface */}
        <div className="flex-1 flex flex-col">
          <div className="border-b border-stroke-divider p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Agent title */}
                <div>
                  <h2 className="text-lg font-semibold">{isAgent ? agentName : 'Test your agent'}</h2>
                  {isAdmin && <p className="text-sm text-fg-muted">Send messages to test the MCP knowledge integration</p>}
                </div>
                {/* Conversation dropdown (always shown, compact in agent mode) */}
                {isAgent && (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <select
                        className="text-xs pl-3 pr-7 py-1.5 border border-stroke-card rounded-lg bg-bg-secondary text-fg-primary appearance-none cursor-pointer hover:border-stroke-accent focus:outline-none focus:ring-1 focus:ring-stroke-focus"
                        value={conversationId || ''}
                        onChange={(e) => {
                          if (e.target.value === '__new__') {
                            handleCreateNewConversation()
                          } else if (e.target.value) {
                            switchToConversation(e.target.value)
                          }
                        }}
                      >
                        {conversations.map((conv) => (
                          <option key={conv.id} value={conv.id}>
                            Conv {conv.id.slice(-8)} &middot; {new Date(conv.created_at).toLocaleTimeString()}
                          </option>
                        ))}
                        <option value="__new__">+ New conversation</option>
                      </select>
                      <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                        <svg className="h-3 w-3 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                    {/* Agent Info button */}
                    <div className="relative">
                      <button
                        onClick={() => setShowAgentInfo(!showAgentInfo)}
                        className={cn(
                          "h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border transition-colors",
                          showAgentInfo
                            ? "bg-accent text-fg-on-accent border-accent"
                            : "bg-bg-secondary text-fg-muted border-stroke-card hover:border-accent hover:text-accent"
                        )}
                        title="Agent Details"
                      >
                        i
                      </button>
                      {/* Agent info popover */}
                      {showAgentInfo && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-stroke-divider bg-bg-card shadow-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className="text-sm font-semibold text-fg-default">Agent Details</h3>
                            <button onClick={() => setShowAgentInfo(false)} className="text-fg-muted hover:text-fg-default">
                              <Dismiss20Regular className="h-4 w-4" />
                            </button>
                          </div>

                          {/* Model */}
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">Model</span>
                            <p className="text-sm text-fg-default font-mono bg-bg-secondary rounded-lg px-2.5 py-1.5 mt-1">{selectedModel}</p>
                          </div>

                          {/* Tools */}
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">Tools</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {enabledTools.codeInterpreter && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Code Interpreter</span>}
                              {enabledTools.fileSearch && <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">File Search</span>}
                              {enabledTools.webSearch && <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">Web Search</span>}
                              {enabledTools.airportOps && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Airport Ops MCP</span>}
                              {hasKnowledgeTools && <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent">KB Retrieval</span>}
                              {!enabledTools.codeInterpreter && !enabledTools.fileSearch && !enabledTools.webSearch && !enabledTools.airportOps && !hasKnowledgeTools && (
                                <span className="text-[11px] text-fg-subtle italic">None</span>
                              )}
                            </div>
                          </div>

                          {/* Knowledge Bases */}
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">Knowledge Bases</span>
                            {selectedKnowledgeBases.size > 0 ? (
                              <div className="flex flex-wrap gap-1.5 mt-1">
                                {Array.from(selectedKnowledgeBases).map(kb => (
                                  <span key={kb} className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary text-fg-default border border-stroke-card">{kb}</span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-fg-subtle italic mt-1">None connected</p>
                            )}
                          </div>

                          {/* System Message */}
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-medium">System Message</span>
                            <details className="mt-1">
                              <summary className="text-[11px] text-accent cursor-pointer hover:underline">
                                {agentInstructions.length > 80 ? 'Click to expand' : 'View'}
                              </summary>
                              <pre className="mt-1.5 text-[11px] text-fg-muted bg-bg-secondary rounded-lg p-2.5 whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono leading-relaxed">
                                {agentInstructions || '(No system message)'}
                              </pre>
                            </details>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Export chat button — sibling to agent info */}
                {messages.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => {
                        const el = document.getElementById('export-menu')
                        if (el) el.classList.toggle('hidden')
                      }}
                      className="h-7 w-7 rounded-full flex items-center justify-center text-xs border bg-bg-secondary text-fg-muted border-stroke-card hover:border-accent hover:text-accent transition-colors"
                      title="Export Conversation"
                    >
                      ↓
                    </button>
                    <div id="export-menu" className="hidden absolute top-full right-0 mt-1 z-50 w-52 rounded-xl border border-stroke-divider bg-bg-card shadow-xl py-1">
                      <button
                        onClick={() => { exportChatAsJsonl(); document.getElementById('export-menu')?.classList.add('hidden') }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-bg-secondary transition-colors"
                      >
                        <div className="font-medium text-fg-default">Dataset (JSONL)</div>
                        <div className="text-[10px] text-fg-muted">For evaluation — query, response, context</div>
                      </button>
                      <button
                        onClick={() => { exportChatAsMarkdown(); document.getElementById('export-menu')?.classList.add('hidden') }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-bg-secondary transition-colors"
                      >
                        <div className="font-medium text-fg-default">Prettified (Markdown)</div>
                        <div className="text-[10px] text-fg-muted">Formatted conversation log</div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {/* Source Settings info — read-only in agent mode since MCP uses KB defaults */}
              {selectedKnowledgeBases.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRuntimeSettingsOpen(!runtimeSettingsOpen)}
                  className={cn(
                    "gap-2 text-xs opacity-60",
                    runtimeSettingsOpen && "bg-bg-accent-subtle text-fg-accent opacity-100"
                  )}
                  title="Source settings are read-only — agent uses KB defaults configured at creation time. Use KB Playground (/test) for runtime parameter tuning."
                >
                  <Settings20Regular className="h-4 w-4" />
                  <span className="hidden sm:inline">Source Settings</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-bg-secondary text-fg-subtle">read-only</span>
                </Button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <Bot20Regular className="h-12 w-12 mx-auto text-fg-muted mb-3" />
                <p className="text-sm text-fg-muted">
                  {isAgent ? `How can I help you today?` : 'Start a conversation to test your agent'}
                </p>
                <p className="text-xs text-fg-muted mt-1">Try asking about topics covered in your knowledge bases</p>

                {/* Starter Questions */}
                {starterQuestions.length > 0 && (
                  <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
                    {starterQuestions.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setCurrentMessage(q)
                          // Optionally auto-send
                          setTimeout(() => {
                            const el = document.querySelector('[data-send-btn]') as HTMLButtonElement
                            if (el) el.click()
                          }, 100)
                        }}
                        className="text-left text-sm px-4 py-3 border border-stroke-card rounded-lg hover:bg-bg-hover hover:border-accent/50 transition-all text-fg-default"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              messages.map((message, index) => {
                const msgId = message.id || `msg-${index}`
                const refs = (message.references || []) as KnowledgeBaseReference[]
                const acts = (message.activity || []) as KnowledgeBaseActivityRecord[]
                const msgCodeBlocks = (message as any).codeBlocks || []
                const msgGeneratedFiles = (message as any).generatedFiles || []
                const isUser = message.role === 'user'

                return (
                  <div
                    key={msgId}
                    className={cn(
                      "flex items-start gap-4",
                      isUser && "flex-row-reverse"
                    )}
                  >
                    <div className={cn(
                      "p-2 rounded-full flex-shrink-0",
                      isUser ? "bg-bg-subtle" : "bg-accent-subtle"
                    )}>
                      {isUser ? (
                        <span className="w-4 h-4 flex items-center justify-center text-xs font-semibold">U</span>
                      ) : (
                        <Bot20Regular className="h-4 w-4 text-accent" />
                      )}
                    </div>
                    <div className={cn('flex-1 max-w-[80%] min-w-0', isUser && 'flex justify-end')}>
                      <div className={cn(
                        "rounded-lg p-4 overflow-hidden",
                        isUser
                          ? "bg-accent text-fg-on-accent ml-12"
                          : "bg-bg-card border border-stroke-divider"
                      )}>
                        {/* Message Content */}
                        {isUser ? (
                          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                        ) : (
                          <MarkdownMessage
                            content={message.content || ''}
                            references={refs}
                            activity={acts}
                            messageId={msgId}
                            generatedFiles={msgGeneratedFiles}
                            onActivateCitation={() => handleOpenSourcesPanel(msgId, refs, acts, message.content?.slice(0, 100))}
                          />
                        )}

                        {/* Code Interpreter: collapsible code blocks */}
                        {msgCodeBlocks.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {msgCodeBlocks.map((cb: any, cbIdx: number) => (
                              <details
                                key={cb.id || cbIdx}
                                className="group border border-stroke-divider rounded-lg overflow-hidden"
                              >
                                <summary className="flex items-center gap-2 px-3 py-2 bg-bg-subtle cursor-pointer text-xs text-fg-muted hover:bg-bg-hover select-none">
                                  <CodeText20Regular className="h-4 w-4" />
                                  <span>Python code executed</span>
                                  {cb.status === 'completed' && (
                                    <CheckmarkCircle20Filled className="h-4 w-4 text-green-600 ml-auto" />
                                  )}
                                </summary>
                                <pre className="p-3 text-xs bg-bg-secondary overflow-x-auto max-h-[300px]">
                                  <code className="language-python">{cb.code}</code>
                                </pre>
                              </details>
                            ))}
                          </div>
                        )}

                        {/* Generated files download links (non-image files) */}
                        {msgGeneratedFiles.filter((f: any) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.filename)).length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {msgGeneratedFiles
                              .filter((f: any) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f.filename))
                              .map((file: any, fIdx: number) => (
                                <a
                                  key={fIdx}
                                  href={`/api/foundry/containers/${encodeURIComponent(file.containerId)}/files/${encodeURIComponent(file.fileId)}?filename=${encodeURIComponent(file.filename)}`}
                                  download={file.filename}
                                  className="inline-flex items-center gap-2 px-3 py-2 text-xs bg-bg-subtle hover:bg-bg-hover border border-stroke-divider rounded-lg text-fg-default transition-colors"
                                >
                                  <span>📥</span>
                                  <span>{file.filename}</span>
                                </a>
                              ))
                            }
                          </div>
                        )}

                        {/* Sources button + Eval score bubble */}
                        {!isUser && (refs.length > 0 || (isAdmin && continuousEvalId)) && (
                          <div className="mt-4 pt-4 border-t border-stroke-divider flex items-center gap-2 flex-wrap">
                            {refs.length > 0 && (
                              <SourcesCountButton
                                references={refs}
                                onClick={() => handleOpenSourcesPanel(msgId, refs, acts, message.content?.slice(0, 100))}
                              />
                            )}
                            {isAdmin && continuousEvalId && (
                              <EvalScoreBubble
                                agentName={agentName_saved || agentName}
                                evalId={continuousEvalId}
                                responseTimestamp={message.timestamp ? new Date(message.timestamp).getTime() : undefined}
                              />
                            )}
                          </div>
                        )}

                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-stroke-divider">
                            <div className="text-xs text-fg-muted">
                              🔧 Tools used: {Array.from(new Set(message.toolCalls.map((tc: any) => tc.name || tc.type || 'Tool'))).join(', ')}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
            {isRunning && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-bg-secondary text-fg-secondary flex items-center justify-center">
                  A
                </div>
                <div className="bg-bg-secondary p-3 rounded-lg mr-12">
                  <div className="flex items-center gap-2 text-sm text-fg-muted">
                    <div className="animate-spin h-4 w-4 border-2 border-fg-muted border-t-transparent rounded-full"></div>
                    Thinking...
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-stroke-divider p-4">
            <div className="flex gap-2">
              <Input
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                placeholder="Ask your agent a question..."
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                disabled={isRunning}
              />
              <Button
                data-send-btn
                onClick={sendMessage}
                disabled={!currentMessage.trim() || isRunning}
              >
                Send
              </Button>
            </div>
            <p className="text-xs text-fg-muted mt-2">
              Press Enter to send • Shift+Enter for new line
            </p>
          </div>
        </div>

        {/* Runtime Settings Panel — slide-out for knowledge source parameters */}
        {runtimeSettingsOpen && (
          <div className="w-80 border-l border-stroke-divider bg-bg-card flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-stroke-divider">
              <div>
                <h3 className="text-sm font-semibold">Source Settings</h3>
                <p className="text-[10px] text-fg-subtle mt-0.5">Read-only — KB defaults apply via MCP</p>
              </div>
              <button
                onClick={() => setRuntimeSettingsOpen(false)}
                className="p-1 hover:bg-bg-hover rounded text-fg-muted hover:text-fg-default transition-colors"
              >
                <Dismiss20Regular className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 pointer-events-none opacity-60">
              <RuntimeSettingsPanel
                compact
                knowledgeSources={(() => {
                  // Derive unique knowledge sources from selected KBs
                  const uniqueSources = new Map<string, { name: string; kind?: string }>()
                  Array.from(selectedKnowledgeBases).forEach(kbName => {
                    const kb = knowledgeBases.find(b => b.name === kbName)
                    ;(kb?.knowledgeSources || []).forEach((ks: any) => {
                      if (!uniqueSources.has(ks.name)) {
                        uniqueSources.set(ks.name, {
                          name: ks.name,
                          kind: knowledgeSourcesMap.get(ks.name)?.kind || undefined
                        })
                      }
                    })
                  })
                  return Array.from(uniqueSources.values())
                })()}
                settings={runtimeSettings}
                onSettingsChange={setRuntimeSettings}
                hasWebSource={(() => {
                  return Array.from(selectedKnowledgeBases).some(kbName => {
                    const kb = knowledgeBases.find(b => b.name === kbName)
                    return (kb?.knowledgeSources || []).some((ks: any) =>
                      knowledgeSourcesMap.get(ks.name)?.kind === 'web'
                    )
                  })
                })()}
              />
            </div>
          </div>
        )}

        {/* Sources Panel - Perplexity-style side panel */}
        <SourcesPanel
          isOpen={sourcesPanel.isOpen}
          onClose={handleCloseSourcesPanel}
          references={sourcesPanel.references}
          activity={sourcesPanel.activity}
          query={sourcesPanel.query}
          messageId={sourcesPanel.messageId || ''}
        />
      </div>
    )
  }


  return (
    <div className="flex h-[calc(100vh-3.5rem)] bg-bg-primary">
      {/* Left Navigation */}
      <div className="w-64 bg-bg-secondary border-r border-stroke-divider flex flex-col">
        <div className="p-4 border-b border-stroke-divider">
          <div className="flex items-center gap-2 mb-3">
            <h1 className="text-lg font-semibold">Agent Builder</h1>
            <div className="ml-auto">
              <span className="text-xs px-2 py-1 rounded bg-bg-accent-subtle text-fg-accent font-medium">
                {agentMode === 'foundry' ? 'Foundry' : 'Search'}
              </span>
            </div>
          </div>
          <Input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Agent name"
            className="mt-2"
          />
        </div>

        <nav className="flex-1 p-4">
          <div className="space-y-1">
            {SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    activeSection === section.id
                      ? "bg-bg-accent-subtle text-fg-accent"
                      : "text-fg-default hover:bg-bg-hover"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{section.label}</span>
                  {(section.id === 'knowledge' && selectedKnowledgeBases.size > 0) && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-bg-accent text-fg-on-accent">
                      {selectedKnowledgeBases.size}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="p-4 border-t border-stroke-divider space-y-2">
          {agentMode === 'foundry' ? (
            <>
              <Button
                className="w-full"
                onClick={handleSaveAgent}
                disabled={saving}
              >
                {saving ? 'Creating agent...' : 'Create Foundry Agent'}
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1">
                  Save as draft
                </Button>
                {/* Code button hidden */}
              </div>
              <p className="text-xs text-fg-muted mt-2 text-center">
                You can add knowledge bases after creating the agent
              </p>
            </>
          ) : (
            <>
              <Button
                className="w-full"
                onClick={() => alert('Azure AI Search agent creation - Coming soon!')}
              >
                Create Search Agent
              </Button>
              <Button variant="secondary" className="w-full">
                Configure Index
              </Button>
              <p className="text-xs text-fg-muted mt-2 text-center">
                Direct search integration mode
              </p>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          {renderSectionContent()}
        </div>
      </div>

      {/* Code Modal */}
      <AgentCodeModal
        isOpen={showCodeModal}
        onClose={() => setShowCodeModal(false)}
        agentName={agentName}
        selectedKnowledgeBases={Array.from(selectedKnowledgeBases)}
        agentInstructions={agentInstructions}
        selectedModel={selectedModel}
        assistantId={agentName_saved}
        threadId={conversationId}
      />

      {/* Instructions Expand Modal */}
      {showInstructionsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setShowInstructionsModal(false) }}
        >
          <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-bg-card border border-stroke-divider rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-stroke-divider bg-bg-subtle">
              <div>
                <h3 className="text-sm font-semibold">System Instructions</h3>
                <span className="text-xs text-fg-muted">{agentInstructions.length} characters</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleGenerateStarters}
                  disabled={generatingStarters || !agentInstructions.trim()}
                >
                  {generatingStarters ? 'Generating...' : '✨ Generate starters'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAgentInstructions('')}>Clear</Button>
                <button
                  onClick={() => setShowInstructionsModal(false)}
                  className="p-1.5 hover:bg-bg-hover rounded text-fg-muted hover:text-fg-default transition-colors"
                >
                  <Dismiss20Regular className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-5 overflow-auto">
              <textarea
                value={agentInstructions}
                onChange={(e) => { setAgentInstructions(e.target.value); setSettingsDirty(true) }}
                placeholder="Describe what this agent should do..."
                className="w-full h-full min-h-[60vh] font-mono text-sm p-4 bg-bg-primary border border-stroke-card rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-stroke-focus"
                autoFocus
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AgentBuilderPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div>Loading...</div></div>}>
      <AgentBuilderPageContent />
    </Suspense>
  )
}