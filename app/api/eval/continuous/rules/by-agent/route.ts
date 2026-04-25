import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_URL = process.env.EVAL_SERVICE_URL || ''

export async function GET(req: Request) {
  if (!EVAL_URL) return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
  try {
    const { searchParams } = new URL(req.url)
    const agentName = searchParams.get('agent')
    if (!agentName) return NextResponse.json({ error: 'agent query param required' }, { status: 400 })

    const resp = await fetch(`${EVAL_URL}/continuous/rules/by-agent/${encodeURIComponent(agentName)}`, { cache: 'no-store' })
    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to check agent rule' }, { status: 502 })
  }
}
