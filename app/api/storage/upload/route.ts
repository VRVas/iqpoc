import { NextResponse } from 'next/server'

const PROXY_URL = process.env.STORAGE_PROXY_URL || ''

// Next.js 14 App Router: disable body parsing so we can forward the raw stream
export const runtime = 'nodejs'

export async function POST(req: Request) {
  if (!PROXY_URL) {
    return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  }
  try {
    // Forward the multipart request as-is to the storage proxy
    const contentType = req.headers.get('content-type') || ''
    const body = await req.arrayBuffer()

    const resp = await fetch(`${PROXY_URL}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    })
    const data = await resp.json()
    if (!resp.ok) return NextResponse.json(data, { status: resp.status })
    return NextResponse.json(data, { status: resp.status })
  } catch (err) {
    console.error('[storage/upload] Error:', err)
    return NextResponse.json({ error: 'Failed to upload files' }, { status: 502 })
  }
}
