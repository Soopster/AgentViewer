import { NextRequest, NextResponse } from 'next/server'
import { interruptViewSession } from '@/lib/sessionBackend'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = body?.provider === 'claude' || body?.provider === 'codex' || body?.provider === 'opencode'
    ? body.provider
    : undefined
  try {
    void provider
    await interruptViewSession(sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: message.includes('No running session') ? 409 : 500 })
  }
}
