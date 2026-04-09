import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/continuous/rules
 * 
 * List all continuous evaluation rules.
 * Proxies to eval service /continuous/rules.
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/how-to-monitor-agents-dashboard?tabs=python#set-up-continuous-evaluation
 */
export async function GET() {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ rules: [], error: 'EVAL_SERVICE_URL not configured' })
    }

    const response = await fetch(`${EVAL_SERVICE_URL}/continuous/rules`, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/continuous/rules] Error:', error)
    return NextResponse.json(
      { rules: [], error: error instanceof Error ? error.message : 'Failed to list rules' },
      { status: 500 }
    )
  }
}
