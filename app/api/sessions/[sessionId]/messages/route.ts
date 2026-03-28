import { NextRequest, NextResponse } from 'next/server'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 2000)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  try {
    const messages = await getSessionMessages(sessionId, { limit, offset })
    return NextResponse.json({ messages })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
