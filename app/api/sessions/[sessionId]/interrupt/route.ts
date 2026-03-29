import { NextRequest, NextResponse } from 'next/server'
import { interruptViewSession } from '@/lib/sessionBackend'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    await interruptViewSession(sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: message.includes('No running session') ? 409 : 500 })
  }
}
