import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_URL = process.env.EVAL_SERVICE_URL || ''

export async function GET(req: Request) {
  if (!EVAL_URL) return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
  try {
    const { searchParams } = new URL(req.url)
    const evalId = searchParams.get('eval_id')
    const limit = searchParams.get('limit') || '1'
    if (!evalId) return NextResponse.json({ error: 'eval_id query param required' }, { status: 400 })

    const resp = await fetch(
      `${EVAL_URL}/continuous/latest-scores?eval_id=${encodeURIComponent(evalId)}&limit=${limit}`,
      { cache: 'no-store' }
    )
    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch scores' }, { status: 502 })
  }
}
