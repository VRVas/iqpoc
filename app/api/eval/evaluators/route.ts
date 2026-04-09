import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/evaluators
 * 
 * List available evaluators from the eval service.
 */
export async function GET() {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const response = await fetch(`${EVAL_SERVICE_URL}/evaluators/list`, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('[eval/evaluators] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list evaluators' },
      { status: 500 }
    )
  }
}
