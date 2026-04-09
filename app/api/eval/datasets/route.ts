import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_SERVICE_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * POST /api/eval/datasets
 * 
 * Proxy for dataset operations:
 * - action=upload-inline: Upload inline JSONL data as versioned dataset
 * - action=evaluate: Run evaluation using uploaded dataset file_id
 * 
 * Ref: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/cloud-evaluation?tabs=python#upload-a-dataset-recommended
 */
export async function POST(request: NextRequest) {
  try {
    if (!EVAL_SERVICE_URL) {
      return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    }

    const body = await request.json()
    const { action, ...payload } = body

    if (!action) {
      return NextResponse.json({ error: 'action is required (upload-inline, evaluate)' }, { status: 400 })
    }

    const url = `${EVAL_SERVICE_URL}/datasets/${action}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('[eval/datasets] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to manage dataset' },
      { status: 500 }
    )
  }
}
