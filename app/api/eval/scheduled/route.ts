import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/scheduled?action=list|runs&schedule_id=...
 * POST /api/eval/scheduled (create/delete)
 * 
 * Proxy for scheduled evaluation management.
 * 
 * Ref: https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/ai/azure-ai-projects/samples/evaluations/sample_scheduled_evaluations.py
 */
export async function GET(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ schedules: [], error: 'EVAL_SERVICE_URL not configured' })
    }

    const { searchParams } = request.nextUrl
    const action = searchParams.get('action') || 'list'
    const scheduleId = searchParams.get('schedule_id') || ''

    let url: string
    if (action === 'runs' && scheduleId) {
      url = `${EVAL_SERVICE_URL}/scheduled/runs/${scheduleId}`
    } else {
      url = `${EVAL_SERVICE_URL}/scheduled/list`
    }

    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/scheduled GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch schedules' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const body = await request.json()
    const { action, ...payload } = body

    let url: string
    let method = 'POST'

    if (action === 'create') {
      url = `${EVAL_SERVICE_URL}/scheduled/create`
    } else if (action === 'delete' && payload.schedule_id) {
      url = `${EVAL_SERVICE_URL}/scheduled/delete/${payload.schedule_id}`
      method = 'DELETE'
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/scheduled POST] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to manage schedule' },
      { status: 500 }
    )
  }
}
