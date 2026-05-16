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
    const knowledgeBaseId = params.id

    if (!isOwnedKb(knowledgeBaseId, getServerTenant())) {
      return NextResponse.json({ error: 'Knowledge base not found' }, { status: 404 })
    }

    const body = await request.json()

    const aclHeader = request.headers.get('x-ms-query-source-authorization') ??
      request.headers.get('x-ms-user-authorization') ??
      undefined

    const url = `${ENDPOINT}/knowledgebases/${knowledgeBaseId}/retrieve?api-version=${API_VERSION}`

    // 🔍 DEBUG: Log the complete request payload
    console.log('═══════════════════════════════════════════════════════════')
    console.log('🚀 [SERVER] Knowledge Base Retrieve Request')
    console.log('═══════════════════════════════════════════════════════════')
    console.log('📍 Knowledge Base ID:', knowledgeBaseId)
    console.log('🌐 Azure Search URL:', url)
    console.log('🔐 Has ACL Header:', !!aclHeader)
    console.log('📦 Request Body:', JSON.stringify(body, null, 2))
    console.log('───────────────────────────────────────────────────────────')

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': API_KEY!,
        ...(aclHeader ? { 'x-ms-query-source-authorization': aclHeader } : {})
      },
      body: JSON.stringify(body)
    })

    const responseText = await response.text()

    // 🔍 DEBUG: Log the response
    console.log('📨 [SERVER] Azure Search Response Status:', response.status, response.statusText)
    
    if (!response.ok) {
      let parsedError: unknown = responseText
      try {
        parsedError = JSON.parse(responseText)
      } catch {
        // keep as text
      }

      // 🔍 DEBUG: Log detailed error information
      console.log('❌ [SERVER] Azure Search Error Response:')
      console.log('Status:', response.status, response.statusText)
      console.log('Parsed Error:', JSON.stringify(parsedError, null, 2))
      console.log('Raw Response Text:', responseText)
      console.log('═══════════════════════════════════════════════════════════')

      return NextResponse.json({
        error: `Failed to retrieve from knowledge base (${response.status})`,
        azureError: parsedError,
        details: responseText,
        status: response.status,
        statusText: response.statusText
      }, { status: response.status })
    }

    let data: any = {}
    try {
      data = responseText ? JSON.parse(responseText) : {}
    } catch {
      data = { message: responseText }
    }

    // 🔍 DEBUG: Log successful response with full details
    console.log('✅ [SERVER] Request successful')
    console.log('Response length:', responseText.length, 'characters')
    console.log('───────────────────────────────────────────────────────────')
    console.log('📊 Response Summary:')
    console.log('  - Has response:', !!data.response)
    console.log('  - References count:', data.references?.length || 0)
    console.log('  - Activity count:', data.activity?.length || 0)
    if (data.references?.length > 0) {
      console.log('📚 References:')
      data.references.forEach((ref: any, idx: number) => {
        console.log(`  [${idx}] type: ${ref.type}, id: ${ref.id}, hasSourceData: ${!!ref.sourceData}`)
      })
    }
    if (data.activity?.length > 0) {
      console.log('🔄 Activity:')
      data.activity.forEach((act: any, idx: number) => {
        console.log(`  [${idx}] type: ${act.type}, id: ${act.id}, elapsedMs: ${act.elapsedMs}ms`)
      })
    }
    console.log('───────────────────────────────────────────────────────────')
    console.log('📦 Full Response Data:')
    console.log(JSON.stringify(data, null, 2))
    console.log('═══════════════════════════════════════════════════════════')

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message,
      stack: error.stack,
      type: 'exception'
    }, { status: 500 })
  }
}
