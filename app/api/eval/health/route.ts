import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/health
 * 
 * Health check for the eval service.
 */
export async function GET() {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ status: 'not_configured', error: 'EVAL_SERVICE_URL not set' })
    }

    const response = await fetch(`${EVAL_SERVICE_URL}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({
      status: 'unreachable',
      error: error instanceof Error ? error.message : 'Eval service unreachable',
    })
  }
}
