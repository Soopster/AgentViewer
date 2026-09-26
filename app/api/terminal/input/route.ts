import { NextRequest, NextResponse } from 'next/server'
import { writeTerminalInput } from '@/lib/terminalSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Forwards base64-encoded raw keystrokes into an embedded-terminal PTY.
 * CSRF-gated by proxy.ts (POST /api/* requires a trusted origin).
 */
export async function POST(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('session')
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: 'bad session id' }, { status: 400 })
  }
  let body: { data?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  if (typeof body.data !== 'string' || body.data.length > 1_000_000) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 })
  }
  let bytes: Uint8Array
  try {
    const binary = atob(body.data)
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return NextResponse.json({ error: 'bad base64' }, { status: 400 })
  }
  const ok = writeTerminalInput(id, bytes)
  if (!ok) return NextResponse.json({ error: 'no such session' }, { status: 404 })
  return NextResponse.json({ ok: true })
}