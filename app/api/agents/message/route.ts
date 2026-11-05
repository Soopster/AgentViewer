import { NextRequest, NextResponse } from 'next/server'
import { sendCrossSessionMessage } from '@/lib/crossSessionMessaging'

// Cross-session messaging delivery — the SendMessage half of
// https://code.claude.com/docs/en/cross-session-messaging.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const toName = typeof body.to === 'string' ? body.to.trim() : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const fromSessionId = typeof body.fromSessionId === 'string' ? body.fromSessionId : undefined
  const fromName = typeof body.fromName === 'string' && body.fromName.trim() ? body.fromName.trim() : 'another session'
  if (!toName) return NextResponse.json({ error: 'to is required' }, { status: 400 })
  if (!text.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 })

  try {
    const result = await sendCrossSessionMessage({ fromSessionId, fromName, toName, text })
    const status = result.delivered
      ? 200
      : result.mode === 'not_found'
      ? 404
      : result.mode === 'throttled'
      ? 429
      : 409
    return NextResponse.json(result, { status, headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
