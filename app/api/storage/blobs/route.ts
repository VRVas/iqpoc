import { NextResponse } from 'next/server'
import { getServerTenant, isOwnedContainer } from '@/lib/tenant'

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

    // Tenant data isolation: refuse to list blobs in a container that doesn't
    // belong to the requesting tenant. Returns 404 (matching the KB pattern)
    // so callers can't probe for sibling-tenant container names.
    if (!isOwnedContainer(container, getServerTenant())) {
      return NextResponse.json({ error: 'Container not found' }, { status: 404 })
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
