import { NextRequest, NextResponse } from 'next/server'
import { getRunningQuery } from '@/lib/sessionRuntime'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const q = getRunningQuery(sessionId)

  if (!q) {
    return NextResponse.json({ error: 'No running query for this session' }, { status: 409 })
  }

  try {
    await q.interrupt()
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
