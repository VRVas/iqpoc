import { NextResponse } from 'next/server'

/**
 * Diagnostic endpoint to verify which environment variables are present
 * ⚠️ REMOVE THIS FILE AFTER DEBUGGING
 * This does NOT expose actual values, only checks if they exist
 */
export async function GET() {
  try {
    const envCheck = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      
      // Azure Search
      azureSearch: {
        endpoint: !!process.env.AZURE_SEARCH_ENDPOINT,
        endpointLength: process.env.AZURE_SEARCH_ENDPOINT?.length || 0,
        endpointPrefix: process.env.AZURE_SEARCH_ENDPOINT?.substring(0, 8) || 'missing',
        apiKey: !!process.env.AZURE_SEARCH_API_KEY,
        apiKeyLength: process.env.AZURE_SEARCH_API_KEY?.length || 0,
        apiVersion: !!process.env.AZURE_SEARCH_API_VERSION,
        apiVersionValue: process.env.AZURE_SEARCH_API_VERSION || 'missing',
      },
      
      // Azure OpenAI / Foundry
      azureFoundry: {
        publicEndpoint: !!process.env.NEXT_PUBLIC_FOUNDRY_ENDPOINT,
        publicEndpointLength: process.env.NEXT_PUBLIC_FOUNDRY_ENDPOINT?.length || 0,
        publicEndpointPrefix: process.env.NEXT_PUBLIC_FOUNDRY_ENDPOINT?.substring(0, 8) || 'missing',
        apiKey: !!process.env.FOUNDRY_API_KEY,
        apiKeyLength: process.env.FOUNDRY_API_KEY?.length || 0,
        projectEndpoint: !!process.env.FOUNDRY_PROJECT_ENDPOINT,
        projectEndpointLength: process.env.FOUNDRY_PROJECT_ENDPOINT?.length || 0,
        publicProjectEndpoint: !!process.env.NEXT_PUBLIC_FOUNDRY_PROJECT_ENDPOINT,
        apiVersion: !!process.env.FOUNDRY_API_VERSION,
        apiVersionValue: process.env.FOUNDRY_API_VERSION || 'missing',
      },
      
      // Public Search Endpoint
      publicSearch: {
        endpoint: !!process.env.NEXT_PUBLIC_SEARCH_ENDPOINT,
        endpointLength: process.env.NEXT_PUBLIC_SEARCH_ENDPOINT?.length || 0,
        endpointPrefix: process.env.NEXT_PUBLIC_SEARCH_ENDPOINT?.substring(0, 8) || 'missing',
      },
      
      // Azure Identity (optional)
      azureIdentity: {
        authMethod: process.env.AZURE_AUTH_METHOD || 'not-set',
        tenantId: !!process.env.AZURE_TENANT_ID,
        clientId: !!process.env.AZURE_CLIENT_ID,
        clientSecret: !!process.env.AZURE_CLIENT_SECRET,
      },
      
      // Common issues
      issues: {
        missingSearchEndpoint: !process.env.AZURE_SEARCH_ENDPOINT,
        missingSearchKey: !process.env.AZURE_SEARCH_API_KEY,
        missingSearchApiVersion: !process.env.AZURE_SEARCH_API_VERSION,
        missingFoundryEndpoint: !process.env.NEXT_PUBLIC_FOUNDRY_ENDPOINT,
        missingFoundryKey: !process.env.FOUNDRY_API_KEY,
        missingFoundryProjectEndpoint: !process.env.FOUNDRY_PROJECT_ENDPOINT,
        searchEndpointInvalid: process.env.AZURE_SEARCH_ENDPOINT && !process.env.AZURE_SEARCH_ENDPOINT.startsWith('https://'),
        foundryEndpointInvalid: process.env.NEXT_PUBLIC_FOUNDRY_ENDPOINT && !process.env.NEXT_PUBLIC_FOUNDRY_ENDPOINT.startsWith('https://'),
      },
      
      // Recommendations
      recommendations: [] as string[],
    }
    
    // Generate recommendations
    if (envCheck.issues.missingSearchEndpoint) {
      envCheck.recommendations.push('❌ Add AZURE_SEARCH_ENDPOINT in Vercel Settings → Environment Variables')
    }
    if (envCheck.issues.missingSearchKey) {
      envCheck.recommendations.push('❌ Add AZURE_SEARCH_API_KEY in Vercel Settings → Environment Variables')
    }
    if (envCheck.issues.missingSearchApiVersion) {
      envCheck.recommendations.push('❌ Add AZURE_SEARCH_API_VERSION in Vercel Settings → Environment Variables (use: 2025-11-01-preview)')
    }
    if (envCheck.issues.missingFoundryEndpoint) {
      envCheck.recommendations.push('❌ Add NEXT_PUBLIC_FOUNDRY_ENDPOINT in Vercel Settings → Environment Variables')
    }
    if (envCheck.issues.missingFoundryKey) {
      envCheck.recommendations.push('❌ Add FOUNDRY_API_KEY in Vercel Settings → Environment Variables')
    }
    if (envCheck.issues.missingFoundryProjectEndpoint) {
      envCheck.recommendations.push('❌ Add FOUNDRY_PROJECT_ENDPOINT in Vercel Settings → Environment Variables')
    }
    if (envCheck.issues.searchEndpointInvalid) {
      envCheck.recommendations.push('⚠️ AZURE_SEARCH_ENDPOINT should start with https://')
    }
    if (envCheck.issues.foundryEndpointInvalid) {
      envCheck.recommendations.push('⚠️ NEXT_PUBLIC_FOUNDRY_ENDPOINT should start with https://')
    }
    
    // Add redeploy reminder if there are issues
    if (envCheck.recommendations.length > 0) {
      envCheck.recommendations.push('🔄 After adding/fixing variables, REDEPLOY in Vercel to pick up changes')
    } else {
      envCheck.recommendations.push('✅ All required environment variables are present!')
    }
    
    return NextResponse.json(envCheck, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { 
        error: 'Failed to check environment variables', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
