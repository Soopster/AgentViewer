import { NextRequest, NextResponse } from 'next/server'
import { cleanupProtocolRunWorktrees } from '@/lib/agentCoordination'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  try {
    const result = await cleanupProtocolRunWorktrees(runId, { force: body.force === true })
    if (!result.snapshot) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
