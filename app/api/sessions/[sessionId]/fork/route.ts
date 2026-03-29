import { NextRequest, NextResponse } from 'next/server'
import { forkViewSession } from '@/lib/sessionBackend'

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
    const result = await forkViewSession({ sessionId, body, provider })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
