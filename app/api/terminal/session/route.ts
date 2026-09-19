import { NextRequest, NextResponse } from 'next/server'
import { killTerminalSession } from '@/lib/terminalSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Tears down an embedded-terminal PTY session. */
export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('session')
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: 'bad session id' }, { status: 400 })
  }
  killTerminalSession(id)
  return NextResponse.json({ ok: true })
}