import { NextResponse } from 'next/server'
import { readProtocolRun } from '@/lib/agentCoordination'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  try {
    const snapshot = await readProtocolRun(runId)
    if (!snapshot) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
