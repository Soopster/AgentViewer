import { NextRequest, NextResponse } from 'next/server'
import { getSessionInfo, renameSession, tagSession } from '@anthropic-ai/claude-agent-sdk'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    const info = await getSessionInfo(sessionId)
    if (!info) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    return NextResponse.json({ info })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json()
  try {
    if ('title' in body) {
      await renameSession(sessionId, body.title)
    } else if ('tag' in body) {
      await tagSession(sessionId, body.tag ?? null)
    } else {
      return NextResponse.json({ error: 'title or tag required' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
