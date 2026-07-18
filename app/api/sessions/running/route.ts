import { NextResponse } from 'next/server'
import { readViewRuntimeActivity } from '@/lib/sessionBackend'
import { isAgentProvider } from '@/lib/provider'
import { dismissViewerAttention, postViewerAttention } from '@/lib/viewerAttention'

// Every session with a turn running in THIS server process, each carrying any
// Claude prompts the turn is blocked on. Process-local, like the per-session
// /running probe. Powers remotely-attached TUIs (fleet strip, attention
// inbox, live-turn reattach) — they poll this instead of the in-process
// registry.
export async function GET() {
  return NextResponse.json(
    readViewRuntimeActivity(),
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({})) as { attentionId?: unknown }
  if (typeof body.attentionId !== 'string' || !body.attentionId) {
    return NextResponse.json({ error: 'attentionId is required' }, { status: 400 })
  }
  return NextResponse.json({ dismissed: dismissViewerAttention(body.attentionId) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const detail = typeof body.detail === 'string' ? body.detail : undefined
  const provider = isAgentProvider(body.provider) ? body.provider : 'claude'
  if (!sessionId || !title) {
    return NextResponse.json({ error: 'sessionId and title are required' }, { status: 400 })
  }
  return NextResponse.json({
    attention: postViewerAttention({ sessionId, provider, title, detail }),
  })
}
