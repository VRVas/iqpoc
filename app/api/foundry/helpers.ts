/**
 * Shared helpers for Foundry Agent Service API routes.
 *
 * Design notes (eval-readiness):
 *   Every response that creates or references a thread / run includes
 *   `x-thread-id` and `x-run-id` headers. A future Python eval layer can
 *   capture these from the Next.js response to correlate Foundry traces
 *   with evaluation datasets without parsing response bodies.
 */

import { getFoundryBearerToken } from '@/lib/token-manager'

const FOUNDRY_PROJECT_ENDPOINT = process.env.FOUNDRY_PROJECT_ENDPOINT
const API_VERSION = process.env.FOUNDRY_AGENT_API_VERSION || '2025-05-15-preview'

/**
 * Build an absolute URL for the Foundry Agent Service REST API.
 *
 * @example agentsUrl('/agents')            → …/agents?api-version=…
 * @example agentsUrl('/threads/t1/runs')   → …/threads/t1/runs?api-version=…
 */
export function agentsUrl(path: string): string {
  if (!FOUNDRY_PROJECT_ENDPOINT) {
    throw new Error('FOUNDRY_PROJECT_ENDPOINT is not configured')
  }
  // Ensure no double slashes
  const base = FOUNDRY_PROJECT_ENDPOINT.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}?api-version=${API_VERSION}`
}

/**
 * Return common headers (Authorization + Content-Type) for an upstream call.
 */
export async function foundryHeaders(): Promise<Record<string, string>> {
  const token = await getFoundryBearerToken()
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Convenience: forward the upstream JSON body as a NextResponse, preserving
 * the HTTP status and injecting tracing headers when provided.
 */
export function forwardResponse(
  upstreamResponse: Response,
  data: unknown,
  tracing?: { threadId?: string; runId?: string }
) {
  const { NextResponse } = require('next/server')
  const headers: Record<string, string> = {}
  if (tracing?.threadId) headers['x-thread-id'] = tracing.threadId
  if (tracing?.runId) headers['x-run-id'] = tracing.runId

  return NextResponse.json(data, {
    status: upstreamResponse.status,
    headers,
  })
}
