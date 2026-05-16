import { NextRequest, NextResponse } from 'next/server'
import { getServerTenant } from '@/lib/tenant'

/**
 * POST /api/access/verify
 * Body: { password: string }
 * Validates against ACCESS_PASSWORD (server-only env var) for the active tenant.
 * Returns 200 on match (caller is expected to set the cookie client-side),
 * 401 on mismatch, 404 if the general access gate is disabled for this tenant.
 *
 * Moving the comparison server-side avoids shipping the password in the JS bundle,
 * which was the case in the original client-only implementation.
 */
export async function POST(request: NextRequest) {
  const tenant = getServerTenant()

  if (!tenant.generalAccessGate?.enabled) {
    return NextResponse.json({ error: 'General access gate is disabled for this tenant.' }, { status: 404 })
  }

  const expected = process.env.ACCESS_PASSWORD
  if (!expected) {
    // Fail closed: if the deployment doesn't set ACCESS_PASSWORD we never accept.
    return NextResponse.json({ error: 'ACCESS_PASSWORD is not configured on the server.' }, { status: 500 })
  }

  let body: { password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const submitted = typeof body.password === 'string' ? body.password : ''
  if (submitted.length === 0 || submitted !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
