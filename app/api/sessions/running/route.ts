import { NextResponse } from 'next/server'
import { readViewRuntimeActivity } from '@/lib/sessionBackend'
import { dismissViewerAttention } from '@/lib/viewerAttention'

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
