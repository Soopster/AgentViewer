import { NextRequest, NextResponse } from 'next/server'
import { appendProtocolEvent, readProtocolRun } from '@/lib/agentCoordination'
import { AGENT_PROTOCOL_VERSION, type AgentProtocolEvent } from '@/lib/agentProtocol'

function sanitizeEvent(runId: string, value: unknown): AgentProtocolEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.version !== AGENT_PROTOCOL_VERSION) return null
  if (record.runId !== runId) return null
  if (typeof record.agentId !== 'string' || !record.agentId.trim()) return null
  if (typeof record.type !== 'string' || !record.type.trim()) return null
  return {
    version: AGENT_PROTOCOL_VERSION,
    runId,
    agentId: record.agentId.trim(),
    type: record.type as AgentProtocolEvent['type'],
    taskId: typeof record.taskId === 'string' && record.taskId.trim() ? record.taskId.trim() : undefined,
    lockId: typeof record.lockId === 'string' && record.lockId.trim() ? record.lockId.trim() : undefined,
    summary: typeof record.summary === 'string' && record.summary.trim() ? record.summary.trim() : undefined,
    detail: typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : undefined,
    paths: Array.isArray(record.paths) ? record.paths.filter((path): path is string => typeof path === 'string') : undefined,
    payload: record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? record.payload as Record<string, unknown>
      : undefined,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
  }
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
