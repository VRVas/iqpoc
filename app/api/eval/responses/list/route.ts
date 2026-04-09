import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/responses/list?agent_name=xxx&limit=50
 * 
 * List recent response logs from the eval service.
 * These response IDs can be submitted for Agent Response Evaluation.
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#agent-response-evaluation
 */
export async function GET(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ responses: [], total: 0, error: 'EVAL_SERVICE_URL not configured' })
    }

    const { searchParams } = request.nextUrl
    const agentName = searchParams.get('agent_name') || ''
    const limit = searchParams.get('limit') || '50'

    let url = `${EVAL_SERVICE_URL}/response-log/list?limit=${limit}`
    if (agentName) url += `&agent_name=${encodeURIComponent(agentName)}`

    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/responses/list] Error:', error)
    return NextResponse.json(
      { responses: [], total: 0, error: error instanceof Error ? error.message : 'Failed to list responses' },
      { status: 500 }
    )
  }
}
