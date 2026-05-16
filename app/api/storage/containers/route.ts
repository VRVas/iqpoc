import { NextResponse } from 'next/server'
import { getServerTenant, isOwnedContainer, validateOwnedName } from '@/lib/tenant'

const PROXY_URL = process.env.STORAGE_PROXY_URL || ''

export async function GET() {
  if (!PROXY_URL) {
    return NextResponse.json({ error: 'STORAGE_PROXY_URL not configured' }, { status: 500 })
  }
  try {
    const resp = await fetch(`${PROXY_URL}/containers`, { cache: 'no-store' })
    const data = await resp.json()
    if (!resp.ok) return NextResponse.json(data, { status: resp.status })

    // Tenant data isolation: the storage account is shared across tenants, so
    // strip out containers that don't belong to the requesting tenant.
    const tenant = getServerTenant()
    if (Array.isArray(data?.containers)) {
      data.containers = data.containers.filter((name: string) => isOwnedContainer(name, tenant))
    }

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

    // Tenant data isolation: refuse to create containers whose name doesn't
    // belong to this tenant — either the prefix is missing or the name trips
    // the excludeNameSubstrings ban-list.
    const tenant = getServerTenant()
    const ownership = validateOwnedName(body?.name, 'container', tenant)
    if (!ownership.ok) {
      return NextResponse.json(
        {
          error: `Container name "${body?.name}" is not valid for this tenant.`,
          hint: ownership.reason,
        },
        { status: 400 }
      )
    }

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
