import { NextRequest, NextResponse } from 'next/server'
import { resizeTerminal } from '@/lib/terminalSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Adjusts the embedded-terminal PTY geometry (cols/rows). */
export async function POST(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('session')
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: 'bad session id' }, { status: 400 })
  }
  let body: { cols?: unknown; rows?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  const cols = typeof body.cols === 'number' ? body.cols : NaN
  const rows = typeof body.rows === 'number' ? body.rows : NaN
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return NextResponse.json({ error: 'cols and rows are required' }, { status: 400 })
  }
  const ok = resizeTerminal(id, cols, rows)
  if (!ok) return NextResponse.json({ error: 'no such session' }, { status: 404 })
  return NextResponse.json({ ok: true })
}