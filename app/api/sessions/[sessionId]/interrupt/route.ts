import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { interruptViewSession } from '@/lib/sessionBackend'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = isAgentProvider(body?.provider) ? body.provider : undefined
  const turnRequestId = typeof body?.turnRequestId === 'string' && body.turnRequestId.trim()
    ? body.turnRequestId.trim()
    : undefined
  try {
    void provider
    const stillQueued = await interruptViewSession(sessionId, turnRequestId)
    return NextResponse.json({ ok: true, ...(stillQueued !== undefined ? { stillQueued } : {}) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: message.includes('No running session') ? 409 : 500 })
  }
}
