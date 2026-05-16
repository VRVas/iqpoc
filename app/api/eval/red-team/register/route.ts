import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * POST /api/eval/red-team/register?eval_id=...&run_id=...&name=...&agent_name=...
 *
 * Proxies to eval service /red-team/register. Used by the results page to
 * backfill historical red team runs into Cosmos persistence on first load.
 *
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python
 */
export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }
    const qs = request.nextUrl.searchParams.toString()
    const response = await fetch(`${EVAL_SERVICE_URL}/red-team/register?${qs}`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/red-team/register] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to register' },
      { status: 500 }
    )
  }
}
