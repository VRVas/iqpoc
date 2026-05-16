import { NextRequest, NextResponse } from 'next/server'
import { getServerTenant, isOwnedKb } from '@/lib/tenant'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const revalidate = 0

const ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT
const API_KEY = process.env.AZURE_SEARCH_API_KEY
const API_VERSION = process.env.AZURE_SEARCH_API_VERSION

interface RouteContext {
  params: Promise<{ id: string }> | { id: string }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = context.params instanceof Promise ? await context.params : context.params
    const { id } = params

    if (!isOwnedKb(id, getServerTenant())) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }

    const body = await request.json()

    const response = await fetch(`${ENDPOINT}/knowledgebases/${id}/retrieve?api-version=${API_VERSION}`, {
      method: 'POST',
      headers: {
        'api-key': API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json(
        { error: 'Failed to query knowledge base', details: errorText },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
