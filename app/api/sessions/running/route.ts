import { NextResponse } from 'next/server'
import { listViewRunningSessions } from '@/lib/sessionBackend'

// Every session with a turn running in THIS server process, each carrying any
// Claude prompts the turn is blocked on. Process-local, like the per-session
// /running probe. Powers remotely-attached TUIs (fleet strip, attention
// inbox, live-turn reattach) — they poll this instead of the in-process
// registry.
export async function GET() {
  return NextResponse.json(
    { running: listViewRunningSessions() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
