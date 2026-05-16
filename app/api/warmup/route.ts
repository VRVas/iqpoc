import { NextResponse } from 'next/server'
import { getFoundryBearerToken } from '@/lib/token-manager'

// SWA managed Functions cold-start after ~20 min idle. This endpoint is hit
// every 5 minutes by an Azure Monitor availability test (web test) so the
// instance, the AAD token cache, and the keepalive HTTPS socket to Foundry
// all stay warm. See docs/swa-warmup.md for details.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FOUNDRY_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const AGENTS_API_VERSION = process.env.FOUNDRY_AGENT_LIST_API_VERSION || 'v1'

type Step = { name: string; ok: boolean; ms: number; detail?: string }

export async function GET() {
  const startedAt = Date.now()
  const steps: Step[] = []

  // Step 1: warm the AAD token cache (the biggest cold-start cost)
  let token: string | null = null
  const tokenStart = Date.now()
  try {
    token = await getFoundryBearerToken()
    steps.push({ name: 'aad_token', ok: true, ms: Date.now() - tokenStart })
  } catch (e: any) {
    steps.push({
      name: 'aad_token',
      ok: false,
      ms: Date.now() - tokenStart,
      detail: e?.message?.slice(0, 200) || 'token fetch failed',
    })
  }

  // Step 2: lightweight Foundry ping so the HTTPS keepalive socket stays open
  const foundryStart = Date.now()
  if (token && FOUNDRY_ENDPOINT) {
    try {
      const url = `${FOUNDRY_ENDPOINT.replace(/\/$/, '')}/agents?api-version=${AGENTS_API_VERSION}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      })
      clearTimeout(timer)
      steps.push({
        name: 'foundry_ping',
        ok: r.ok,
        ms: Date.now() - foundryStart,
        detail: `status ${r.status}`,
      })
    } catch (e: any) {
      steps.push({
        name: 'foundry_ping',
        ok: false,
        ms: Date.now() - foundryStart,
        detail: e?.message?.slice(0, 200) || 'foundry ping failed',
      })
    }
  } else if (!FOUNDRY_ENDPOINT) {
    steps.push({ name: 'foundry_ping', ok: false, ms: 0, detail: 'FOUNDRY_PROJECT_ENDPOINT not set' })
  }

  // Always return 200 so the availability test stays green even if Foundry has
  // a transient blip — the *function instance* is warm regardless of Foundry.
  // The availability test does a ContentMatch on "ok" below.
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      total_ms: Date.now() - startedAt,
      steps,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': 'application/json',
      },
    }
  )
}
