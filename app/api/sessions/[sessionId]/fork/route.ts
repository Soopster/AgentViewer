import { NextRequest, NextResponse } from 'next/server'
import { forkSession } from '@anthropic-ai/claude-agent-sdk'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  try {
    const result = await forkSession(sessionId, { title: body.title })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
