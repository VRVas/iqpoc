import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * POST /api/eval/responses/log
 * 
 * Proxy to eval service response logging.
 * Called by /api/foundry/responses after each agent interaction.
 */
export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ status: 'skipped', reason: 'EVAL_SERVICE_URL not configured' })
    }

    const body = await request.json()
    const response = await fetch(`${EVAL_SERVICE_URL}/response-log/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/responses/log] Error:', error)
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Failed to log response' },
      { status: 500 }
    )
  }
}
