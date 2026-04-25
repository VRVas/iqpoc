import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const PROXY_URL = process.env.STORAGE_PROXY_URL || ''

export async function GET(
  _req: Request,
  { params }: { params: { key: string } }
) {
  if (!PROXY_URL) return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  try {
    const resp = await fetch(`${PROXY_URL}/insights/${encodeURIComponent(params.key)}`, { cache: 'no-store' })
    if (resp.status === 404) return NextResponse.json({ found: false }, { status: 404 })
    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to read insight' }, { status: 502 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { key: string } }
) {
  if (!PROXY_URL) return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  try {
    const body = await req.json()
    const resp = await fetch(`${PROXY_URL}/insights/${encodeURIComponent(params.key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save insight' }, { status: 502 })
  }
}
