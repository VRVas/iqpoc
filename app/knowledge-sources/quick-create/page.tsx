'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronLeft20Regular, Database20Regular, Globe20Regular, CloudArrowUp20Regular,
  Add20Regular, DocumentArrowUp20Regular, Dismiss20Regular
} from '@fluentui/react-icons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createKnowledgeSource } from '@/lib/api'
import { LoadingSkeleton } from '@/components/shared/loading-skeleton'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type SourceType = 'indexedOneLake' | 'searchIndex' | 'azureBlob' | 'remoteSharePoint' | 'indexedSharePoint' | 'web'
type BlobTab = 'upload' | 'existing'

const ALLOWED_EXTENSIONS = [
  '.pdf', '.docx', '.doc', '.docm', '.xlsx', '.xls', '.xlsm',
  '.pptx', '.ppt', '.pptm', '.msg', '.eml', '.epub',
  '.html', '.htm', '.json', '.csv', '.md', '.txt', '.rtf',
  '.xml', '.kml', '.odt', '.ods', '.odp', '.gz', '.zip',
]
const ACCEPT_STRING = ALLOWED_EXTENSIONS.join(',')
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_TOTAL_SIZE = 500 * 1024 * 1024

interface QuickCreateConfig {
  sourceType: SourceType
  name: string
  connectionString: string
  containerName?: string
  folderPath?: string
  indexName?: string
  urls?: string[]
  domains?: string[]
}

const SOURCE_TYPE_INFO = {
  azureBlob: {
    icon: CloudArrowUp20Regular,
    title: 'Azure Blob Storage',
    description: 'Upload documents or connect to existing files',
    requiredFields: ['containerName'],
    defaultValues: { containerName: '', folderPath: '', embeddingModel: 'text-embedding-3-large', completionModel: 'gpt-5' }
  },
  searchIndex: {
    icon: Database20Regular,
    title: 'Azure AI Search Index',
    description: 'Connect to an existing search index',
    requiredFields: ['connectionString', 'indexName'],
    defaultValues: { indexName: 'healthcare-index' }
  },
  web: {
    icon: Globe20Regular,
    title: 'Web Sources',
    description: 'Crawl and index web pages',
    requiredFields: ['domains'],
    defaultValues: { domains: ['www.qatarairways.com', 'dohahamadairport.com'] }
  }
}

// ─── Dropdown with loading + new-item ───

function SmartSelect({
  items, loading, value, onChange, onCreateNew, placeholder, allowCreate = true, disabled = false
}: {
  items: string[], loading: boolean, value: string, onChange: (v: string) => void,
  onCreateNew?: (name: string) => void, placeholder: string, allowCreate?: boolean, disabled?: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameError, setNameError] = useState('')

  const handleCreate = () => {
    if (!newName.trim()) return
    if (items.includes(newName.trim())) {
      setNameError('Already exists')
      return
    }
    onCreateNew?.(newName.trim())
    onChange(newName.trim())
    setCreating(false)
    setNewName('')
    setNameError('')
  }

  if (creating) {
    return (
      <div className="flex gap-2 items-start">
        <div className="flex-1">
          <Input value={newName} onChange={(e) => { setNewName(e.target.value); setNameError('') }} placeholder="Enter name..." autoFocus className={cn(nameError && 'border-red-500')} />
          {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
        </div>
        <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>Add</Button>
        <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName(''); setNameError('') }}>
          <Dismiss20Regular className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading}
          className={cn(
            'w-full px-3 py-2 rounded-xl border bg-bg-canvas text-fg-default text-sm appearance-none cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-accent',
            disabled ? 'opacity-50 cursor-not-allowed' : '',
            'border-stroke-divider'
          )}
        >
          <option value="">{loading ? 'Loading...' : placeholder}</option>
          {items.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        {loading && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <svg className="h-4 w-4 animate-spin text-fg-muted" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
          </div>
        )}
      </div>
      {allowCreate && !disabled && (
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)} className="shrink-0 gap-1">
          <Add20Regular className="h-4 w-4" /> New
        </Button>
      )}
    </div>
  )
}

// ─── File drop zone ───

function FileDropZone({ files, onFilesChange }: { files: File[], onFilesChange: (files: File[]) => void }) {
  const [dragOver, setDragOver] = useState(false)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles)
    const valid: File[] = []
    for (const f of arr) {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      if (!ALLOWED_EXTENSIONS.includes(ext || '')) continue
      if (f.size > MAX_FILE_SIZE) continue
      if (!files.some(ef => ef.name === f.name)) valid.push(f)
    }
    onFilesChange([...files, ...valid])
  }, [files, onFilesChange])

  const removeFile = (name: string) => onFilesChange(files.filter(f => f.name !== name))
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        onClick={() => {
          const input = document.createElement('input')
          input.type = 'file'; input.multiple = true; input.accept = ACCEPT_STRING
          input.onchange = () => { if (input.files) addFiles(input.files) }
          input.click()
        }}
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
          dragOver ? 'border-accent bg-accent/5' : 'border-stroke-divider hover:border-fg-muted'
        )}
      >
        <DocumentArrowUp20Regular className="h-10 w-10 mx-auto text-fg-muted mb-3" />
        <p className="text-sm font-medium text-fg-default">Drag & drop files here, or click to browse</p>
        <p className="text-xs text-fg-muted mt-1">PDF, DOCX, XLSX, PPTX, HTML, JSON, CSV, MD, TXT, RTF, XML, and more</p>
        <p className="text-xs text-fg-muted">Max 100 MB per file</p>
      </div>
      {files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map(f => (
            <div key={f.name} className="flex items-center justify-between px-3 py-2 bg-bg-secondary rounded-lg text-sm">
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-fg-muted text-xs mx-3">{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={(e) => { e.stopPropagation(); removeFile(f.name) }} className="text-fg-muted hover:text-red-500">
                <Dismiss20Regular className="h-4 w-4" />
              </button>
            </div>
          ))}
          <p className="text-xs text-fg-muted px-1">
            {files.length} file{files.length !== 1 ? 's' : ''} · {(totalSize / (1024 * 1024)).toFixed(1)} MB total
            {totalSize > MAX_TOTAL_SIZE && <span className="text-red-500 ml-2">Exceeds 500 MB limit</span>}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main page ───

function QuickCreateKnowledgeSourcePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = searchParams.get('returnUrl')
  const { toast } = useToast()

  const [step, setStep] = useState<'select' | 'configure'>('select')
  const [selectedType, setSelectedType] = useState<SourceType | null>(null)
  const [config, setConfig] = useState<QuickCreateConfig>({ sourceType: 'azureBlob', name: '', connectionString: '' })
  const [creating, setCreating] = useState(false)

  // Blob-specific state
  const [blobTab, setBlobTab] = useState<BlobTab>('upload')
  const [useDefaultStorage, setUseDefaultStorage] = useState(true)
  const [files, setFiles] = useState<File[]>([])
  const [containers, setContainers] = useState<string[]>([])
  const [containersLoading, setContainersLoading] = useState(false)
  const [containersFailed, setContainersFailed] = useState(false)
  const [folders, setFolders] = useState<string[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [overwriteFiles, setOverwriteFiles] = useState<string[]>([])
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false)

  useEffect(() => {
    if (selectedType) {
      const defaults = SOURCE_TYPE_INFO[selectedType]?.defaultValues || {}
      setConfig(prev => ({ ...prev, sourceType: selectedType, name: '', ...defaults }))
    }
  }, [selectedType])

  // Fetch containers when default storage selected
  useEffect(() => {
    if (selectedType === 'azureBlob' && useDefaultStorage) {
      setContainersLoading(true)
      setContainersFailed(false)
      fetch('/api/storage/containers')
        .then(r => r.json())
        .then(data => { setContainers(data.containers || []); setContainersFailed(false) })
        .catch(() => { setContainersFailed(true); setContainers([]) })
        .finally(() => setContainersLoading(false))
    } else {
      setContainers([])
    }
  }, [selectedType, useDefaultStorage])

  // Fetch folders when container selected
  useEffect(() => {
    if (selectedType === 'azureBlob' && useDefaultStorage && config.containerName) {
      setFoldersLoading(true)
      fetch(`/api/storage/blobs?container=${encodeURIComponent(config.containerName)}`)
        .then(r => r.json())
        .then(data => setFolders((data.folders || []).map((f: string) => f.replace(/\/$/, ''))))
        .catch(() => setFolders([]))
        .finally(() => setFoldersLoading(false))
    } else {
      setFolders([])
    }
  }, [selectedType, useDefaultStorage, config.containerName])

  const handleTypeSelect = (type: SourceType) => { setSelectedType(type); setStep('configure') }

  const validateConfig = () => {
    if (!config.name) return false
    if (selectedType === 'azureBlob') {
      if (!config.containerName) return false
      if (blobTab === 'upload' && useDefaultStorage && files.length === 0) return false
      if (blobTab === 'upload' && files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_SIZE) return false
      if (!useDefaultStorage && !config.connectionString) return false
    } else if (selectedType === 'searchIndex') {
      if (!config.connectionString || !config.indexName) return false
    } else if (selectedType === 'web') {
      if (!config.domains || config.domains.length === 0) return false
    }
    return true
  }

  const handleCreateContainer = async (name: string) => {
    try {
      const resp = await fetch('/api/storage/containers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error)
      if (!containers.includes(name)) setContainers(prev => [...prev, name])
      toast({ title: 'Container created', description: name, type: 'success' })
    } catch (err: any) {
      toast({ title: 'Failed to create container', description: err.message, type: 'error' })
    }
  }

  const handleCreateFolder = (name: string) => {
    if (!folders.includes(name)) setFolders(prev => [...prev, name])
    setConfig(prev => ({ ...prev, folderPath: name }))
  }

  const checkAndCreate = async () => {
    if (!validateConfig() || !selectedType) return
    // Pre-upload collision check for upload tab + default storage
    if (selectedType === 'azureBlob' && blobTab === 'upload' && files.length > 0 && useDefaultStorage && config.containerName) {
      try {
        const prefix = config.folderPath ? `${config.folderPath}/` : ''
        const resp = await fetch(`/api/storage/blobs?container=${encodeURIComponent(config.containerName)}&prefix=${encodeURIComponent(prefix)}`)
        const data = await resp.json()
        const existingNames = (data.blobs || []).map((b: any) => {
          const parts = b.name.split('/')
          return parts[parts.length - 1]
        })
        const collisions = files.filter(f => existingNames.includes(f.name)).map(f => f.name)
        if (collisions.length > 0) {
          setOverwriteFiles(collisions)
          setShowOverwriteDialog(true)
          return
        }
      } catch { /* if check fails, proceed anyway */ }
    }
    await handleCreate()
  }

  const handleCreate = async () => {
    if (!validateConfig() || !selectedType) return
    setShowOverwriteDialog(false)
    setCreating(true)
    try {
      // Upload files (upload tab + default storage only)
      if (selectedType === 'azureBlob' && blobTab === 'upload' && files.length > 0 && useDefaultStorage) {
        toast({ title: 'Uploading files...', description: `${files.length} file${files.length !== 1 ? 's' : ''}`, type: 'info', duration: 0 })
        const formData = new FormData()
        formData.append('container', config.containerName || '')
        if (config.folderPath) formData.append('folder', config.folderPath)
        for (const f of files) formData.append('files', f)
        const uploadResp = await fetch('/api/storage/upload', { method: 'POST', body: formData })
        const uploadData = await uploadResp.json()
        if (!uploadResp.ok) throw new Error(uploadData.error || 'Upload failed')
        toast({ title: 'Files uploaded', description: `${uploadData.count} file${uploadData.count !== 1 ? 's' : ''}`, type: 'success' })
      }

      // Create knowledge source
      toast({ title: 'Starting indexation pipeline...', description: config.name, type: 'info', duration: 0 })
      const ingestionParameters = {
        embeddingModel: { kind: 'azureOpenAI', azureOpenAIParameters: { deploymentId: 'text-embedding-3-large', modelName: 'text-embedding-3-large' } },
        chatCompletionModel: { kind: 'azureOpenAI', azureOpenAIParameters: { deploymentId: 'gpt-5', modelName: 'gpt-5' } }
      }
      let payload: any = { name: config.name, kind: config.sourceType, description: 'Created via Knowledge Source wizard' }
      if (config.sourceType === 'azureBlob') {
        payload.azureBlobParameters = {
          connectionString: useDefaultStorage ? '__SERVER_INJECT__' : config.connectionString,
          containerName: config.containerName,
          ...(config.folderPath ? { folderPath: config.folderPath + '/' } : {}),
          ingestionParameters
        }
      } else if (config.sourceType === 'searchIndex') {
        payload.searchIndexParameters = { connectionString: config.connectionString, indexName: config.indexName }
      } else if (config.sourceType === 'web') {
        payload.webParameters = {
          domains: { allowedDomains: (config.domains || []).map(d => ({ address: d.replace(/^https?:\/\//i, ''), includeSubpages: true })), blockedDomains: [] }
        }
      }

      await createKnowledgeSource(payload)
      toast({ title: 'Knowledge source created!', description: `${config.name} is now indexing`, type: 'success' })
      setTimeout(() => { router.push(returnUrl || '/knowledge-sources') }, 1500)
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, type: 'error', duration: 0 })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="border-b border-stroke-divider bg-bg-secondary">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => step === 'configure' ? setStep('select') : router.back()} className="gap-2">
              <ChevronLeft20Regular className="h-4 w-4" /> Back
            </Button>
            <h1 className="text-lg font-semibold text-fg-primary">Quick Create Knowledge Source</h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {step === 'select' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-2">Select source type</h2>
              <p className="text-fg-muted">Choose how you want to connect your data</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(SOURCE_TYPE_INFO).map(([type, info]) => {
                const Icon = info.icon
                return (
                  <Card key={type} className="p-6 cursor-pointer hover:border-stroke-accent transition-all" onClick={() => handleTypeSelect(type as SourceType)}>
                    <div className="space-y-3">
                      <Icon className="h-8 w-8 text-fg-accent" />
                      <h3 className="font-semibold">{info.title}</h3>
                      <p className="text-sm text-fg-muted">{info.description}</p>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {step === 'configure' && selectedType && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-2">Configure {SOURCE_TYPE_INFO[selectedType].title}</h2>
              <p className="text-fg-muted">Set up your knowledge source connection.</p>
            </div>

            {selectedType === 'azureBlob' && (
              <div className="flex border-b border-stroke-divider">
                {(['upload', 'existing'] as BlobTab[]).map(tab => (
                  <button key={tab} onClick={() => setBlobTab(tab)}
                    className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                      blobTab === tab ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg-default'
                    )}>
                    {tab === 'upload' ? 'Upload Files' : 'Existing Files'}
                  </button>
                ))}
              </div>
            )}

            <Card className="p-6 space-y-5">
              <div>
                <label className="text-sm font-medium text-fg-secondary">Name <span className="text-red-500">*</span></label>
                <Input value={config.name} onChange={(e) => setConfig({ ...config, name: e.target.value })} placeholder="Knowledge source name" className="mt-1" />
              </div>

              {selectedType === 'azureBlob' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-fg-secondary">Storage</label>
                    <div className="flex gap-4 mt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={useDefaultStorage} onChange={() => setUseDefaultStorage(true)} className="accent-accent" />
                        <span className="text-sm">Default Storage</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" checked={!useDefaultStorage} onChange={() => setUseDefaultStorage(false)} className="accent-accent" />
                        <span className="text-sm">Bring Your Own</span>
                      </label>
                    </div>
                    {!useDefaultStorage && (
                      <>
                        <Input value={config.connectionString} onChange={(e) => setConfig({ ...config, connectionString: e.target.value })}
                          placeholder="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=..." className="mt-2 font-mono text-xs" />
                        <p className="text-xs text-fg-muted mt-1">BYO storage must have public network access enabled.</p>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-fg-secondary">Container <span className="text-red-500">*</span></label>
                    <div className="mt-1">
                      {useDefaultStorage && !containersFailed ? (
                        <SmartSelect items={containers} loading={containersLoading} value={config.containerName || ''}
                          onChange={(v) => setConfig({ ...config, containerName: v, folderPath: '' })}
                          onCreateNew={blobTab === 'upload' ? handleCreateContainer : undefined}
                          placeholder="Select a container" allowCreate={blobTab === 'upload'} />
                      ) : (
                        <Input value={config.containerName} onChange={(e) => setConfig({ ...config, containerName: e.target.value })} placeholder="Container name" />
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-fg-secondary">Folder <span className="text-fg-muted text-xs">(optional)</span></label>
                    <div className="mt-1">
                      {useDefaultStorage && config.containerName && !containersFailed ? (
                        <SmartSelect items={folders} loading={foldersLoading} value={config.folderPath || ''}
                          onChange={(v) => setConfig({ ...config, folderPath: v })}
                          onCreateNew={blobTab === 'upload' ? handleCreateFolder : undefined}
                          placeholder="Select a folder (optional)" allowCreate={blobTab === 'upload'} />
                      ) : (
                        <Input value={config.folderPath} onChange={(e) => setConfig({ ...config, folderPath: e.target.value })}
                          placeholder="e.g., healthcare/labels/" disabled={!config.containerName} />
                      )}
                    </div>
                  </div>

                  {blobTab === 'upload' && useDefaultStorage && (
                    <div>
                      <label className="text-sm font-medium text-fg-secondary">Files <span className="text-red-500">*</span></label>
                      <div className="mt-1"><FileDropZone files={files} onFilesChange={setFiles} /></div>
                    </div>
                  )}

                  {blobTab === 'upload' && !useDefaultStorage && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                      <p className="text-sm text-yellow-700 dark:text-yellow-400">
                        File upload is only available with Default Storage. For BYO storage, upload files directly to your storage account, then use the "Existing Files" tab.
                      </p>
                    </div>
                  )}
                </>
              )}

              {selectedType === 'searchIndex' && (
                <>
                  <div>
                    <label className="text-sm font-medium text-fg-secondary">Connection String <span className="text-red-500">*</span></label>
                    <Input value={config.connectionString} onChange={(e) => setConfig({ ...config, connectionString: e.target.value })}
                      placeholder="https://your-search.search.windows.net" className="mt-1 font-mono text-sm" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-fg-secondary">Index Name <span className="text-red-500">*</span></label>
                    <Input value={config.indexName} onChange={(e) => setConfig({ ...config, indexName: e.target.value })}
                      placeholder="e.g., healthcare-index" className="mt-1" />
                  </div>
                </>
              )}

              {selectedType === 'web' && (
                <div>
                  <label className="text-sm font-medium text-fg-secondary">Domains <span className="text-red-500">*</span></label>
                  <textarea value={config.domains?.join('\n') || ''}
                    onChange={(e) => setConfig({ ...config, domains: e.target.value.split('\n').filter(Boolean) })}
                    placeholder="Enter one domain per line (e.g. www.qatarairways.com)"
                    className="mt-1 w-full p-3 border border-stroke-divider rounded-xl text-sm h-32 bg-bg-canvas text-fg-default focus:outline-none focus:ring-2 focus:ring-accent" />
                  <p className="text-xs text-fg-muted mt-1">Domain names only (no https:// prefix).</p>
                </div>
              )}

              {selectedType !== 'searchIndex' && (
                <div className="p-3 bg-bg-info-subtle border border-stroke-info rounded-lg">
                  <p className="text-xs text-fg-info">
                    <strong>Smart defaults applied:</strong> We're using text-embedding-3-large for embeddings and gpt-5 for chat completion.
                    These can be customized later if needed.
                  </p>
                </div>
              )}
            </Card>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setStep('select')}>Back</Button>
              <Button onClick={checkAndCreate} disabled={creating || !validateConfig()}>
                {creating ? (
                  <><svg className="h-4 w-4 animate-spin mr-2" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg> Creating...</>
                ) : 'Create Knowledge Source'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Overwrite confirmation dialog */}
      {showOverwriteDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-bg-card border border-stroke-divider rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-fg-default mb-2">Files already exist</h3>
            <p className="text-sm text-fg-muted mb-3">
              The following {overwriteFiles.length === 1 ? 'file' : `${overwriteFiles.length} files`} already {overwriteFiles.length === 1 ? 'exists' : 'exist'} in the target location and will be overwritten:
            </p>
            <div className="max-h-40 overflow-y-auto mb-4 space-y-1">
              {overwriteFiles.map(name => (
                <div key={name} className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
                  <svg className="h-4 w-4 text-yellow-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" /></svg>
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowOverwriteDialog(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Overwrite & Continue</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function QuickCreateKnowledgeSourcePage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <QuickCreateKnowledgeSourcePageContent />
    </Suspense>
  )
}