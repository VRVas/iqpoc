import { NextResponse } from 'next/server'

/**
 * POST /api/foundry/generate-starters
 *
 * Generates 4 conversation starter questions based on an agent's system message.
 * Uses the Azure OpenAI Chat Completions API directly (no agent required).
 *
 * Endpoint: Azure AI Services (cognitiveservices) — Chat Completions
 * Auth: API key via `api-key` header
 */

const ENDPOINT = 'https://aikb-foundry-q36gpyt3maa7w.cognitiveservices.azure.com'
const API_KEY = process.env.AZURE_OPENAI_API_KEY
const API_VERSION = '2024-04-01-preview'
const DEFAULT_DEPLOYMENT = 'gpt-4.1'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { systemMessage, model } = body

    if (!systemMessage?.trim()) {
      return NextResponse.json(
        { error: 'systemMessage is required' },
        { status: 400 }
      )
    }

    if (!API_KEY) {
      console.error('[generate-starters] AZURE_OPENAI_API_KEY not set')
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const deployment = model || DEFAULT_DEPLOYMENT
    const url = `${ENDPOINT}/openai/deployments/${deployment}/chat/completions?api-version=${API_VERSION}`

    const payload = {
      messages: [
        {
          role: 'system',
          content: `You are a helpful assistant that generates conversation starter questions.

Given the following system message for an AI agent, generate exactly 4 short, practical conversation starter questions that a user might ask this agent. The questions should:
- Be specific and relevant to the agent's domain
- Cover different topics the agent can help with
- Be concise (under 15 words each)
- Be phrased as natural user questions

Return ONLY a JSON array of 4 strings, no other text. Example format:
["Question 1?", "Question 2?", "Question 3?", "Question 4?"]`
        },
        {
          role: 'user',
          content: `System message:\n\n${systemMessage.slice(0, 4000)}`
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 300,
      model: deployment,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': API_KEY,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[generate-starters] API error:', response.status, errText.slice(0, 500))
      return NextResponse.json(
        { error: `Failed to generate starters (${response.status})` },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Chat Completions response: data.choices[0].message.content
    const text = data.choices?.[0]?.message?.content || ''

    // Parse the JSON array from the response
    let starters: string[] = []
    try {
      const jsonMatch = text.match(/\[[\s\S]*?\]/)
      if (jsonMatch) {
        starters = JSON.parse(jsonMatch[0])
      }
    } catch {
      console.warn('[generate-starters] Failed to parse response:', text.slice(0, 300))
    }

    // Ensure we have exactly 4 strings
    starters = starters.filter((s: unknown) => typeof s === 'string' && (s as string).trim()).slice(0, 4)

    if (starters.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate valid starter questions', rawText: text },
        { status: 500 }
      )
    }

    return NextResponse.json({ starters })
  } catch (error) {
    console.error('[generate-starters] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
