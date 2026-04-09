import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * GET /api/eval/custom-evaluators
 * Routes: /list, /prebuilt
 * 
 * POST /api/eval/custom-evaluators
 * Routes: /create-code, /create-prompt, /register-prebuilt/{name}, /delete
 * 
 * Multiplex proxy for custom evaluator management.
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/custom-evaluators
 */
export async function GET(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ evaluators: [], error: 'EVAL_SERVICE_URL not configured' })
    }

    const action = request.nextUrl.searchParams.get('action') || 'list'
    const url = `${EVAL_SERVICE_URL}/custom-evaluators/${action}`

    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/custom-evaluators GET] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch custom evaluators' },
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

    if (!action) {
      return NextResponse.json({ error: 'action is required (create-code, create-prompt, register-prebuilt, delete)' }, { status: 400 })
    }

    // Build the URL based on action
    let url = `${EVAL_SERVICE_URL}/custom-evaluators/${action}`

    // For register-prebuilt, the evaluator_name goes in the URL
    if (action.startsWith('register-prebuilt/')) {
      url = `${EVAL_SERVICE_URL}/custom-evaluators/${action}`
    }

    const method = action === 'delete' ? 'DELETE' : 'POST'

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/custom-evaluators POST] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to manage custom evaluator' },
      { status: 500 }
    )
  }
}
