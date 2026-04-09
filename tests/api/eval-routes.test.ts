/**
 * Comprehensive tests for ALL Next.js evaluation API proxy routes.
 *
 * Tests:
 * - /api/eval/health
 * - /api/eval/evaluators
 * - /api/eval/trigger (with SSRF allowlist)
 * - /api/eval/status/[runId]
 * - /api/eval/responses/log
 * - /api/eval/responses/list
 * - /api/eval/continuous/configure
 * - /api/eval/continuous/rules
 * - /api/eval/red-team/run
 * - /api/eval/red-team/status/[runId]
 * - /api/eval/custom-evaluators
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockFetchResponse(data: any, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  })
}

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), options)
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ===========================================================================
// /api/eval/health
// ===========================================================================

describe('GET /api/eval/health', () => {
  it('returns healthy status from eval service', async () => {
    const { GET } = await import('@/app/api/eval/health/route')
    mockFetchResponse({ status: 'healthy', version: '1.0.0', model_deployment: 'gpt-4.1-mini', app_insights_configured: true })

    const response = await GET()
    const data = await response.json()

    expect(data.status).toBe('healthy')
    expect(data.version).toBe('1.0.0')
  })

  it('returns unreachable when service is down', async () => {
    const { GET } = await import('@/app/api/eval/health/route')
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

    const response = await GET()
    const data = await response.json()

    expect(data.status).toBe('unreachable')
  })

  it('calls the correct upstream URL', async () => {
    const { GET } = await import('@/app/api/eval/health/route')
    mockFetchResponse({ status: 'healthy' })

    await GET()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.objectContaining({ cache: 'no-store' })
    )
  })
})

// ===========================================================================
// /api/eval/evaluators
// ===========================================================================

describe('GET /api/eval/evaluators', () => {
  it('returns evaluator list from eval service', async () => {
    const { GET } = await import('@/app/api/eval/evaluators/route')
    mockFetchResponse({ built_in: [{ name: 'builtin.coherence' }], custom: [] })

    const response = await GET()
    const data = await response.json()

    expect(data.built_in).toBeDefined()
    expect(data.custom).toBeDefined()
  })

  it('calls the correct upstream URL', async () => {
    const { GET } = await import('@/app/api/eval/evaluators/route')
    mockFetchResponse({ built_in: [], custom: [] })

    await GET()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/evaluators/list'),
      expect.any(Object)
    )
  })
})

// ===========================================================================
// /api/eval/trigger — SSRF protection tests
// ===========================================================================

describe('POST /api/eval/trigger', () => {
  it('allows valid /evaluate/batch endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')
    mockFetchResponse({ eval_id: 'eval_1', run_id: 'run_1', status: 'running' })

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/evaluate/batch', payload: { name: 'test' } }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('allows valid /evaluate/agent-target endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')
    mockFetchResponse({ eval_id: 'eval_1', run_id: 'run_1', status: 'running' })

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/evaluate/agent-target', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('allows valid /evaluate/by-response-ids endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')
    mockFetchResponse({ eval_id: 'eval_1', run_id: 'run_1', status: 'running' })

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/evaluate/by-response-ids', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('allows valid /evaluate/synthetic endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')
    mockFetchResponse({ eval_id: 'eval_1', run_id: 'run_1', status: 'running' })

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/evaluate/synthetic', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('allows valid /evaluate/single endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')
    mockFetchResponse({ eval_id: 'eval_1' })

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/evaluate/single', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
  })

  it('BLOCKS SSRF path traversal', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/../../../etc/passwd', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Invalid endpoint')
  })

  it('BLOCKS arbitrary internal endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/red-team/run', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('BLOCKS empty endpoint', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('returns 400 when endpoint is missing', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('forwards upstream errors', async () => {
    const { POST } = await import('@/app/api/eval/trigger/route')
    mockFetchResponse({ detail: 'Internal error' }, 500)

    const request = makeRequest('/api/eval/trigger', {
      method: 'POST',
      body: JSON.stringify({ endpoint: '/evaluate/batch', payload: {} }),
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})

// ===========================================================================
// /api/eval/status/[runId]
// ===========================================================================

describe('GET /api/eval/status/[runId]', () => {
  it('returns status from eval service', async () => {
    const { GET } = await import('@/app/api/eval/status/[runId]/route')
    mockFetchResponse({ eval_id: 'e1', run_id: 'r1', status: 'completed' })

    const request = makeRequest('/api/eval/status/run_123?eval_id=eval_456')
    const response = await GET(request, { params: Promise.resolve({ runId: 'run_123' }) })
    const data = await response.json()

    expect(data.status).toBe('completed')
  })

  it('returns 400 when eval_id is missing', async () => {
    const { GET } = await import('@/app/api/eval/status/[runId]/route')

    const request = makeRequest('/api/eval/status/run_123')
    const response = await GET(request, { params: Promise.resolve({ runId: 'run_123' }) })

    expect(response.status).toBe(400)
  })
})

// ===========================================================================
// /api/eval/responses/log
// ===========================================================================

describe('POST /api/eval/responses/log', () => {
  it('proxies log entry to eval service', async () => {
    const { POST } = await import('@/app/api/eval/responses/log/route')
    mockFetchResponse({ status: 'logged', response_id: 'resp_001' })

    const request = makeRequest('/api/eval/responses/log', {
      method: 'POST',
      body: JSON.stringify({ response_id: 'resp_001', agent_name: 'Oryx' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.status).toBe('logged')
    expect(data.response_id).toBe('resp_001')
  })

  it('calls the correct upstream URL', async () => {
    const { POST } = await import('@/app/api/eval/responses/log/route')
    mockFetchResponse({ status: 'logged' })

    const request = makeRequest('/api/eval/responses/log', {
      method: 'POST',
      body: JSON.stringify({ response_id: 'test' }),
    })

    await POST(request)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/response-log/log'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

// ===========================================================================
// /api/eval/responses/list
// ===========================================================================

describe('GET /api/eval/responses/list', () => {
  it('returns response logs from eval service', async () => {
    const { GET } = await import('@/app/api/eval/responses/list/route')
    mockFetchResponse({ responses: [{ response_id: 'r1' }], total: 1, source: 'cosmos' })

    const request = makeRequest('/api/eval/responses/list?limit=10')
    const response = await GET(request)
    const data = await response.json()

    expect(data.responses).toHaveLength(1)
    expect(data.source).toBe('cosmos')
  })

  it('passes agent_name filter to upstream', async () => {
    const { GET } = await import('@/app/api/eval/responses/list/route')
    mockFetchResponse({ responses: [], total: 0, source: 'cosmos' })

    const request = makeRequest('/api/eval/responses/list?agent_name=Oryx&limit=5')
    await GET(request)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('agent_name=Oryx'),
      expect.any(Object)
    )
  })
})

// ===========================================================================
// /api/eval/continuous/configure
// ===========================================================================

describe('POST /api/eval/continuous/configure', () => {
  it('proxies configuration to eval service', async () => {
    const { POST } = await import('@/app/api/eval/continuous/configure/route')
    mockFetchResponse({ rule_id: 'r1', status: 'created', agent_name: 'Oryx', evaluators: ['violence'], max_hourly_runs: 100 })

    const request = makeRequest('/api/eval/continuous/configure', {
      method: 'POST',
      body: JSON.stringify({ agent_name: 'Oryx', evaluators: ['violence'] }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.status).toBe('created')
    expect(data.agent_name).toBe('Oryx')
  })
})

// ===========================================================================
// /api/eval/continuous/rules
// ===========================================================================

describe('GET /api/eval/continuous/rules', () => {
  it('returns rules list from eval service', async () => {
    const { GET } = await import('@/app/api/eval/continuous/rules/route')
    mockFetchResponse({ rules: [{ id: 'r1', enabled: true }] })

    const response = await GET()
    const data = await response.json()

    expect(data.rules).toHaveLength(1)
    expect(data.rules[0].enabled).toBe(true)
  })
})

// ===========================================================================
// /api/eval/red-team/run
// ===========================================================================

describe('POST /api/eval/red-team/run', () => {
  it('proxies red team run to eval service', async () => {
    const { POST } = await import('@/app/api/eval/red-team/run/route')
    mockFetchResponse({ eval_id: 'e1', run_id: 'r1', taxonomy_id: 't1', status: 'running', estimated_duration_minutes: 5 })

    const request = makeRequest('/api/eval/red-team/run', {
      method: 'POST',
      body: JSON.stringify({ agent_name: 'Oryx' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.eval_id).toBe('e1')
    expect(data.taxonomy_id).toBe('t1')
  })

  it('calls the correct upstream URL', async () => {
    const { POST } = await import('@/app/api/eval/red-team/run/route')
    mockFetchResponse({ eval_id: 'e1', run_id: 'r1', status: 'running' })

    const request = makeRequest('/api/eval/red-team/run', {
      method: 'POST',
      body: JSON.stringify({ agent_name: 'Oryx' }),
    })

    await POST(request)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/red-team/run'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

// ===========================================================================
// /api/eval/red-team/status/[runId]
// ===========================================================================

describe('GET /api/eval/red-team/status/[runId]', () => {
  it('returns status from eval service', async () => {
    const { GET } = await import('@/app/api/eval/red-team/status/[runId]/route')
    mockFetchResponse({ eval_id: 'e1', run_id: 'r1', status: 'completed' })

    const request = makeRequest('/api/eval/red-team/status/run_1?eval_id=eval_1')
    const response = await GET(request, { params: Promise.resolve({ runId: 'run_1' }) })
    const data = await response.json()

    expect(data.status).toBe('completed')
  })

  it('returns 400 when eval_id missing', async () => {
    const { GET } = await import('@/app/api/eval/red-team/status/[runId]/route')

    const request = makeRequest('/api/eval/red-team/status/run_1')
    const response = await GET(request, { params: Promise.resolve({ runId: 'run_1' }) })

    expect(response.status).toBe(400)
  })
})

// ===========================================================================
// /api/eval/custom-evaluators
// ===========================================================================

describe('GET /api/eval/custom-evaluators', () => {
  it('lists evaluators with action=list', async () => {
    const { GET } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ evaluators: [{ name: 'test_eval', version: '1' }], total: 1 })

    const request = makeRequest('/api/eval/custom-evaluators?action=list')
    const response = await GET(request)
    const data = await response.json()

    expect(data.evaluators).toHaveLength(1)
  })

  it('returns prebuilt with action=prebuilt', async () => {
    const { GET } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ evaluators: [{ name: 'kb_citation_checker' }] })

    const request = makeRequest('/api/eval/custom-evaluators?action=prebuilt')
    const response = await GET(request)
    const data = await response.json()

    expect(data.evaluators[0].name).toBe('kb_citation_checker')
  })

  it('defaults to list when no action', async () => {
    const { GET } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ evaluators: [], total: 0 })

    const request = makeRequest('/api/eval/custom-evaluators')
    await GET(request)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/custom-evaluators/list'),
      expect.any(Object)
    )
  })
})

describe('POST /api/eval/custom-evaluators', () => {
  it('creates code evaluator', async () => {
    const { POST } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ status: 'created', name: 'test', version: '1', type: 'code' })

    const request = makeRequest('/api/eval/custom-evaluators', {
      method: 'POST',
      body: JSON.stringify({ action: 'create-code', name: 'test', display_name: 'Test', description: 'Test', code_text: 'def grade(s,i): return 0.0' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.status).toBe('created')
    expect(data.type).toBe('code')
  })

  it('creates prompt evaluator', async () => {
    const { POST } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ status: 'created', name: 'test', version: '1', type: 'prompt' })

    const request = makeRequest('/api/eval/custom-evaluators', {
      method: 'POST',
      body: JSON.stringify({ action: 'create-prompt', name: 'test', display_name: 'Test', description: 'Test', prompt_text: 'Rate...' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.type).toBe('prompt')
  })

  it('registers prebuilt evaluator', async () => {
    const { POST } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ status: 'created', name: 'kb_citation_checker', version: '1' })

    const request = makeRequest('/api/eval/custom-evaluators', {
      method: 'POST',
      body: JSON.stringify({ action: 'register-prebuilt/kb_citation_checker' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.status).toBe('created')
  })

  it('deletes evaluator', async () => {
    const { POST } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ status: 'deleted', name: 'test', version: '1' })

    const request = makeRequest('/api/eval/custom-evaluators', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', name: 'test', version: '1' }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(data.status).toBe('deleted')
  })

  it('returns 400 when action is missing', async () => {
    const { POST } = await import('@/app/api/eval/custom-evaluators/route')

    const request = makeRequest('/api/eval/custom-evaluators', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('sends DELETE method to upstream for delete action', async () => {
    const { POST } = await import('@/app/api/eval/custom-evaluators/route')
    mockFetchResponse({ status: 'deleted' })

    const request = makeRequest('/api/eval/custom-evaluators', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', name: 'test', version: '1' }),
    })

    await POST(request)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
