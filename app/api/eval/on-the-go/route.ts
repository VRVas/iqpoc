import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EVAL_URL = process.env.EVAL_SERVICE_URL || ''

/**
 * POST /api/eval/on-the-go
 * 
 * Triggers an explicit per-response evaluation using the eval service's
 * by-response-ids endpoint. Returns eval_id + run_id for polling.
 */
export async function POST(req: Request) {
  if (!EVAL_URL) return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
  try {
    const body = await req.json()
    const { response_id, evaluators } = body

    if (!response_id) {
      return NextResponse.json({ error: 'response_id is required' }, { status: 400 })
    }

    // Default evaluators for on-the-go: quality + safety + agent
    // Note: protected_material is excluded — it requires explicit response mapping
    // that azure_ai_responses data source doesn't provide, blocking the entire run.
    const evalList = evaluators || [
      'coherence',
      'fluency',
      'relevance',
      'task_adherence',
      'intent_resolution',
      'violence',
      'hate_unfairness',
      'self_harm',
      'sexual',
      'indirect_attack',
    ]

    const resp = await fetch(`${EVAL_URL}/evaluate/by-response-ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'On-The-Go Evaluation',
        response_ids: [response_id],
        evaluators: evalList,
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error('[on-the-go] eval-service error:', resp.status, errText)
      return NextResponse.json({ error: 'Failed to start evaluation', details: errText }, { status: resp.status })
    }

    const data = await resp.json()
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('[on-the-go] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
