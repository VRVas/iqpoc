import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/history?action=evals|recent-runs|runs&eval_id=...&limit=20
 * 
 * Proxy to eval service history endpoints.
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results
 */
export async function GET(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const { searchParams } = request.nextUrl
    const action = searchParams.get('action') || 'recent-runs'
    const limit = searchParams.get('limit') || '20'
    const evalId = searchParams.get('eval_id') || ''

    let url: string
    if (action === 'evals') {
      url = `${EVAL_SERVICE_URL}/history/evals?limit=${limit}`
    } else if (action === 'runs' && evalId) {
      url = `${EVAL_SERVICE_URL}/history/evals/${evalId}/runs?limit=${limit}`
    } else {
      url = `${EVAL_SERVICE_URL}/history/recent-runs?limit=${limit}`
    }

    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/history] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch history' },
      { status: 500 }
    )
  }
}
