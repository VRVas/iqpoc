import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

// Allowlist of valid eval service endpoints to prevent SSRF
const ALLOWED_ENDPOINTS = [
  '/evaluate/batch',
  '/evaluate/agent-target',
  '/evaluate/by-response-ids',
  '/evaluate/synthetic',
  '/evaluate/single',
  '/evaluate/model-target',
]

/**
 * POST /api/eval/trigger
 * 
 * Proxy to evaluation service. Accepts a body with:
 * - endpoint: which eval service endpoint to call (must be in allowlist)
 * - payload: the request body to forward
 */
export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const body = await request.json()
    const { endpoint, payload } = body

    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
    }

    // Validate endpoint against allowlist
    if (!ALLOWED_ENDPOINTS.includes(endpoint)) {
      return NextResponse.json({ error: `Invalid endpoint: ${endpoint}. Allowed: ${ALLOWED_ENDPOINTS.join(', ')}` }, { status: 400 })
    }

    const url = `${EVAL_SERVICE_URL}${endpoint}`
    console.log(`[eval/trigger] Proxying POST to ${url}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[eval/trigger] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger evaluation' },
      { status: 500 }
    )
  }
}
