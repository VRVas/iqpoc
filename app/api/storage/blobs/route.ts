import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const PROXY_URL = process.env.STORAGE_PROXY_URL || ''

export async function GET(req: Request) {
  if (!PROXY_URL) {
    return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const container = searchParams.get('container')
    const prefix = searchParams.get('prefix') || ''
    if (!container) {
      return NextResponse.json({ error: 'container query param is required' }, { status: 400 })
    }
    const resp = await fetch(
      `${PROXY_URL}/blobs?container=${encodeURIComponent(container)}&prefix=${encodeURIComponent(prefix)}`,
      { cache: 'no-store' }
    )
    const data = await resp.json()
    if (!resp.ok) return NextResponse.json(data, { status: resp.status })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[storage/blobs] Error:', err)
    return NextResponse.json({ error: 'Failed to list blobs' }, { status: 502 })
  }
}
