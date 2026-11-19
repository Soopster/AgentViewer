import { NextResponse } from 'next/server'
import { clearSessionReport, isReportedState, listSessionReports, recordSessionReport } from '@/lib/sessionReports'

// What non-SDK agents have said about themselves (see lib/sessionReports.ts).
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId') || undefined
  return NextResponse.json({ reports: listSessionReports(sessionId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  if (typeof body.source !== 'string' || !body.source.trim()) return NextResponse.json({ error: 'source is required' }, { status: 400 })
  if (!isReportedState(body.state)) return NextResponse.json({ error: 'state must be working, blocked or idle' }, { status: 400 })
  const report = recordSessionReport({
    source: body.source,
    state: body.state,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
    seq: typeof body.seq === 'number' ? body.seq : undefined,
    ttlMs: typeof body.ttlMs === 'number' ? body.ttlMs : undefined,
  })
  // An older sequence number is not an error: the newer report already stands.
  return NextResponse.json({ ok: true, stale: report === null, report })
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({})) as { source?: unknown }
  if (typeof body.source !== 'string' || !body.source) return NextResponse.json({ error: 'source is required' }, { status: 400 })
  return NextResponse.json({ cleared: clearSessionReport(body.source) })
}
