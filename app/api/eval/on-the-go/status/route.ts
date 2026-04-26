import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/on-the-go/status?eval_id=X&run_id=Y
 * 
 * Polls the eval service for run status and results.
 * Uses a short timeout (5s) so the caller can retry quickly.
 */
export async function GET(req: Request) {
  if (!EVAL_URL) return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
  try {
    const { searchParams } = new URL(req.url)
    const evalId = searchParams.get('eval_id')
    const runId = searchParams.get('run_id')

    if (!evalId || !runId) {
      return NextResponse.json({ error: 'eval_id and run_id query params required' }, { status: 400 })
    }

    const resp = await fetch(
      `${EVAL_URL}/evaluate/status/${encodeURIComponent(runId)}?eval_id=${encodeURIComponent(evalId)}`,
      { cache: 'no-store' }
    )

    if (!resp.ok) {
      const errText = await resp.text()
      return NextResponse.json({ error: 'Failed to check status', details: errText }, { status: resp.status })
    }

    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[on-the-go/status] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
