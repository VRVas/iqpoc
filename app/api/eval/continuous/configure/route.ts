import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * POST /api/eval/continuous/configure
 * 
 * Create or update a continuous evaluation rule for an agent.
 * Proxies to eval service /continuous/configure.
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#create-a-continuous-evaluation-rule
 */
export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const body = await request.json()
    const response = await fetch(`${EVAL_SERVICE_URL}/continuous/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/continuous/configure] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to configure continuous evaluation' },
      { status: 500 }
    )
  }
}
