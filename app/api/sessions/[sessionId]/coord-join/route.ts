import { NextRequest, NextResponse } from 'next/server'
import { joinSessionToCoordinatorRun, leaveCoordinatorSession } from '@/lib/agentCoordination'
import { isAgentProvider } from '@/lib/provider'
import { readViewSessionInfo } from '@/lib/sessionBackend'

// Murmur-inspired cooperative join: bind THIS already-open session to an
// existing Coordinator run as a teammate, no worktree or spawned subprocess.
// See lib/agentCoordination.ts (joinSessionToCoordinatorRun / drainCooperativeInbox).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  const providerParam = isAgentProvider(body.provider) ? body.provider : undefined
  try {
    const info = await readViewSessionInfo(sessionId, providerParam)
    if (!info) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    const result = await joinSessionToCoordinatorRun({
      runId,
      sessionId,
      provider: info.provider,
      cwd: info.cwd ?? process.cwd(),
      name: name || info.provider,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    const result = await leaveCoordinatorSession(sessionId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
