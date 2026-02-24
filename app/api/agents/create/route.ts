import { NextRequest, NextResponse } from 'next/server';

const ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT;
const API_KEY = process.env.AZURE_SEARCH_API_KEY;
const API_VERSION = process.env.AZURE_SEARCH_API_VERSION;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Inject Azure AI Services credentials server-side
    // Azure AI Search requires the API key and resource URI for model access
    const openAIEndpoint = process.env.NEXT_PUBLIC_AZURE_OPENAI_ENDPOINT
    const openAIKey = process.env.AZURE_OPENAI_API_KEY || process.env.FOUNDRY_API_KEY

    if (body.models && body.models.length > 0) {
      body.models.forEach((model: any) => {
        if (model.kind === 'azureOpenAI' && model.azureOpenAIParameters) {
          if (openAIEndpoint) model.azureOpenAIParameters.resourceUri = openAIEndpoint
          if (openAIKey) model.azureOpenAIParameters.apiKey = openAIKey
          // Remove authIdentity when using API key
          delete model.azureOpenAIParameters.authIdentity
        }
      });
    }

    const response = await fetch(`${ENDPOINT}/agents/${body.name}?api-version=${API_VERSION}`, {
      method: 'PUT',
      headers: {
        'api-key': API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    if (!response.ok) {
      let parsedError = responseText;
      try {
        parsedError = JSON.parse(responseText);
      } catch (e) {
        // Response is not JSON
      }

      return NextResponse.json({
        error: `Failed to create agent (${response.status})`,
        azureError: parsedError,
        details: responseText,
        status: response.status,
        statusText: response.statusText,
        requestBody: body,
        url: `${ENDPOINT}/agents/${body.name}?api-version=${API_VERSION}`
      }, { status: response.status });
    }

    if (response.status === 204) {
      return NextResponse.json({
        success: true,
        message: 'Agent created successfully',
        name: body.name,
        status: 204
      });
    }

    let data = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        data = { message: responseText, name: body.name };
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message,
      stack: error.stack,
      type: 'exception'
    }, { status: 500 });
  }
}