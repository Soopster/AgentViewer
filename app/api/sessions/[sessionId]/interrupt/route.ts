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
  try {
    void provider
    await interruptViewSession(sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: message.includes('No running session') ? 409 : 500 })
  }
}
