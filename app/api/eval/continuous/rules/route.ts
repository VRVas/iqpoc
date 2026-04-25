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

/**
 * PATCH /api/eval/continuous/rules?rule_id=X&enabled=true/false
 * Toggle a rule's enabled state.
 */
export async function PATCH(req: Request) {
  try {
    if (!EVAL_SERVICE_URL) return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    const { searchParams } = new URL(req.url)
    const ruleId = searchParams.get('rule_id')
    const enabled = searchParams.get('enabled') === 'true'
    if (!ruleId) return NextResponse.json({ error: 'rule_id required' }, { status: 400 })

    const resp = await fetch(`${EVAL_SERVICE_URL}/continuous/rules/${encodeURIComponent(ruleId)}?enabled=${enabled}`, { method: 'PATCH' })
    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to toggle rule' }, { status: 502 })
  }
}

/**
 * DELETE /api/eval/continuous/rules?rule_id=X
 * Delete a rule.
 */
export async function DELETE(req: Request) {
  try {
    if (!EVAL_SERVICE_URL) return NextResponse.json({ error: 'EVAL_SERVICE_URL not configured' }, { status: 500 })
    const { searchParams } = new URL(req.url)
    const ruleId = searchParams.get('rule_id')
    if (!ruleId) return NextResponse.json({ error: 'rule_id required' }, { status: 400 })

    const resp = await fetch(`${EVAL_SERVICE_URL}/continuous/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' })
    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 502 })
  }
}
