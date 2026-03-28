import { NextResponse } from 'next/server'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  try {
    const sessions = await listSessions({ limit, offset })
    return NextResponse.json({ sessions })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
