import { NextRequest, NextResponse } from 'next/server'
import { appendProtocolEvent, readProtocolRun } from '@/lib/agentCoordination'
import { sanitizeProtocolEvent, type AgentProtocolEvent } from '@/lib/agentProtocol'

// Shared sanitizer (accepts any supported protocol version), then pin the
// event to the route's runId so a caller can't write into another run.
function sanitizeEvent(runId: string, value: unknown): AgentProtocolEvent | null {
  const event = sanitizeProtocolEvent(value)
  if (!event || event.runId !== runId) return null
  return event
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  try {
    const snapshot = await readProtocolRun(runId)
    if (!snapshot) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    return NextResponse.json({ events: snapshot.events }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await request.json().catch(() => null) as unknown
  const event = sanitizeEvent(runId, body)
  if (!event) return NextResponse.json({ error: 'Invalid protocol event' }, { status: 400 })
  try {
    const snapshot = await appendProtocolEvent(event)
    if (!snapshot) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
