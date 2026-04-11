import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tool-definitions
 * Returns the tool definitions seed from config/tool-definitions.json.
 *
 * POST /api/tool-definitions
 * Updates the tool definitions file with new/modified definitions.
 */
export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'config', 'tool-definitions.json')
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({})
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return NextResponse.json(JSON.parse(content))
  } catch (error) {
    return NextResponse.json({})
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { key, definition } = body

    if (!key || !definition) {
      return NextResponse.json({ error: 'key and definition are required' }, { status: 400 })
    }

    const filePath = path.join(process.cwd(), 'config', 'tool-definitions.json')
    let existing: Record<string, any> = {}
    if (fs.existsSync(filePath)) {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }

    existing[key] = definition
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2))

    return NextResponse.json({ status: 'saved', key })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save tool definition' },
      { status: 500 }
    )
  }
}
