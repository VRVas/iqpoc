import { NextResponse } from 'next/server'

const PROXY_URL = process.env.STORAGE_PROXY_URL || ''

export async function GET() {
  if (!PROXY_URL) {
    return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  }
  try {
    const resp = await fetch(`${PROXY_URL}/containers`, { cache: 'no-store' })
    const data = await resp.json()
    if (!resp.ok) return NextResponse.json(data, { status: resp.status })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[storage/containers] Error:', err)
    return NextResponse.json({ error: 'Failed to list containers' }, { status: 502 })
  }
}

export async function POST(req: Request) {
  if (!PROXY_URL) {
    return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  }
  try {
    const body = await req.json()
    const resp = await fetch(`${PROXY_URL}/containers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) return NextResponse.json(data, { status: resp.status })
    return NextResponse.json(data, { status: resp.status })
  } catch (err) {
    console.error('[storage/containers] Error:', err)
    return NextResponse.json({ error: 'Failed to create container' }, { status: 502 })
  }
}
