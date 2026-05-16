import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/history?action=evals|recent-runs|runs[&eval_id=...&limit=&offset=&type=&category=&agent_name=&status=&date_from=&date_to=&order_by=&order=]
 *
 * Proxy to eval service history endpoints. Forwards all paging/filter/sort
 * query parameters so the Python side can do server-side filtering and paging
 * against Cosmos DB.
 *
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#get-results
 * Ref: https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/offset-limit
 */
export async function GET(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const { searchParams } = request.nextUrl
    const action = searchParams.get('action') || 'recent-runs'
    const evalId = searchParams.get('eval_id') || ''

    // Forward every query param except `action` / `eval_id` (which shape the URL)
    const passThrough = new URLSearchParams()
    searchParams.forEach((value, key) => {
      if (key === 'action' || key === 'eval_id') return
      passThrough.append(key, value)
    })
    if (!passThrough.has('limit')) passThrough.set('limit', '50')

    let url: string
    if (action === 'evals') {
      url = `${EVAL_SERVICE_URL}/history/evals?${passThrough.toString()}`
    } else if (action === 'runs' && evalId) {
      url = `${EVAL_SERVICE_URL}/history/evals/${evalId}/runs?${passThrough.toString()}`
    } else {
      url = `${EVAL_SERVICE_URL}/history/recent-runs?${passThrough.toString()}`
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
