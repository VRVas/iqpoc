import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

interface RouteContext {
  params: Promise<{ runId: string }> | { runId: string }
}

/**
 * GET /api/eval/status/[runId]?eval_id=...
 * 
 * Poll evaluation run status from the eval service.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const params = context.params instanceof Promise ? await context.params : context.params
    const runId = params.runId
    const evalId = request.nextUrl.searchParams.get('eval_id')

    if (!evalId) {
      return NextResponse.json({ error: 'eval_id query parameter is required' }, { status: 400 })
    }

    const url = `${EVAL_SERVICE_URL}/evaluate/status/${runId}?eval_id=${evalId}`
    console.log(`[eval/status] Polling ${url}`)

    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()

    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/status] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    )
  }
}
