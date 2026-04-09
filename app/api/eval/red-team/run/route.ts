import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * POST /api/eval/red-team/run
 * 
 * Trigger a red teaming run against a Foundry agent.
 * Proxies to eval service /red-team/run.
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/run-ai-red-teaming-cloud?tabs=python
 */
export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const body = await request.json()
    const response = await fetch(`${EVAL_SERVICE_URL}/red-team/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/red-team/run] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start red team run' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/eval/red-team/run
 * 
 * List tracked red team runs.
 */
export async function GET() {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ runs: [], error: 'EVAL_SERVICE_URL not configured' })
    }

    const response = await fetch(`${EVAL_SERVICE_URL}/red-team/list`, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/red-team/list] Error:', error)
    return NextResponse.json(
      { runs: [], error: error instanceof Error ? error.message : 'Failed to list red team runs' },
      { status: 500 }
    )
  }
}
