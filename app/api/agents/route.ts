import { NextRequest, NextResponse } from 'next/server'
import { listAddressableSessions } from '@/lib/crossSessionMessaging'

// Cross-session messaging discovery — the ListAgents half of
// https://code.claude.com/docs/en/cross-session-messaging, reimplemented at
// the app layer so it uses the same path on every OS Agent Viewer supports,
// including Windows.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const exclude = searchParams.get('exclude') ?? undefined
  try {
    const sessions = await listAddressableSessions(exclude)
    return NextResponse.json({ sessions }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
