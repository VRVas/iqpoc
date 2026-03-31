import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering - this route always needs fresh data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT
const API_KEY = process.env.AZURE_SEARCH_API_KEY
const API_VERSION = process.env.AZURE_SEARCH_API_VERSION

export async function GET() {
  try {
    if (!ENDPOINT || !API_KEY || !API_VERSION) {
      return NextResponse.json(
        { error: 'Azure Search configuration missing' },
        { status: 500 }
      )
    }

    const response = await fetch(
      `${ENDPOINT}/knowledgesources?api-version=${API_VERSION}`,
      {
        headers: {
          'api-key': API_KEY,
          'Cache-Control': 'no-cache'
        },
        cache: 'no-store'
      }
    )

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch knowledge sources' },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
  } catch (error) {
    console.error('Knowledge sources API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!ENDPOINT || !API_KEY || !API_VERSION) {
      return NextResponse.json(
        { error: 'Azure Search configuration missing' },
        { status: 500 }
      )
    }

    const body = await req.json()
    const sourceName = body.name

    // Inject storage connection using MI-based ResourceId format.
    // The Search service's system-assigned MI has 'Storage Blob Data Reader'
    // on the storage account, so we use ResourceId= format instead of key-based
    // connection strings. This is MCAPS-compliant (allowSharedKeyAccess=false).
    const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || 'aikbstorageq36gpyt3maa7w'
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || 'e7f1696a-37dd-4876-accb-2facb8713917'
    const resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'iqpoc'
    const resourceIdConn = `ResourceId=/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/${storageAccountName};`

    if (body.azureBlobParameters) {
      const clientConn = body.azureBlobParameters.connectionString || ''
      // Replace if empty, placeholder, or any key-based connection string
      if (!clientConn || clientConn === '__SERVER_INJECT__' || !clientConn.startsWith('ResourceId=')) {
        body.azureBlobParameters.connectionString = resourceIdConn
      }
    }

    // Inject Azure OpenAI endpoint server-side and use Managed Identity auth.
    // The Search service's system-assigned MI has 'Cognitive Services OpenAI User'
    // on the AI Services resource, so we omit apiKey and authIdentity.
    // This is MCAPS-compliant and survives disableLocalAuth=true.
    const openAIEndpoint = process.env.NEXT_PUBLIC_AZURE_OPENAI_ENDPOINT

    const injectCredentials = (model: any) => {
      if (model?.kind === 'azureOpenAI' && model.azureOpenAIParameters) {
        if (openAIEndpoint) model.azureOpenAIParameters.resourceUri = openAIEndpoint
        // Use MI auth: remove apiKey so Search uses its system-assigned identity
        delete model.azureOpenAIParameters.apiKey
        delete model.azureOpenAIParameters.authIdentity
      }
    }

    // Models are nested inside <sourceType>Parameters.ingestionParameters per the API schema
    const paramKeys = ['azureBlobParameters', 'indexedOneLakeParameters', 'indexedSharePointParameters']
    for (const key of paramKeys) {
      const ingestion = body[key]?.ingestionParameters
      if (ingestion) {
        if (ingestion.embeddingModel) injectCredentials(ingestion.embeddingModel)
        if (ingestion.chatCompletionModel) injectCredentials(ingestion.chatCompletionModel)
      }
    }

    const requestBody = JSON.stringify(body)
    console.log('[KS PUT] Sending to Azure:', `${ENDPOINT}/knowledgesources('${sourceName}')?api-version=${API_VERSION}`)
    console.log('[KS PUT] Payload:', requestBody)

    const response = await fetch(
      `${ENDPOINT}/knowledgesources('${sourceName}')?api-version=${API_VERSION}`,
      {
        method: 'PUT',
        headers: {
          'api-key': API_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: requestBody
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[KS PUT] Azure error:', response.status, errorText)
      let errorMessage = 'Failed to create knowledge source'
      try {
        const errorData = JSON.parse(errorText)
        errorMessage = errorData.error?.message || errorMessage
      } catch {}
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Knowledge source creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}