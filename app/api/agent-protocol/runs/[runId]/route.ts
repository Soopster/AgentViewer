import { NextResponse } from 'next/server'
import { deleteProtocolRun, promoteLearningCandidateAdmin, readProtocolRun, resolveProtocolDecisionAdmin, reviewProtocolPhaseAdmin, reviewProtocolRunAdmin } from '@/lib/agentCoordination'

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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  try {
    const result = await deleteProtocolRun(runId)
    if (!result.deleted) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  try {
    if (body.action === 'review-phase') {
      const phase = typeof body.phase === 'string' ? body.phase.trim() : ''
      if (!phase) return NextResponse.json({ error: 'phase is required' }, { status: 400 })
      const snapshot = await reviewProtocolPhaseAdmin(runId, {
        phase,
        approved: body.approved === true,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        detail: typeof body.detail === 'string' ? body.detail : undefined,
      })
      return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'review-run') {
      const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
      if (!summary) return NextResponse.json({ error: 'summary is required' }, { status: 400 })
      const snapshot = await reviewProtocolRunAdmin(runId, {
        approved: body.approved === true,
        summary,
        detail: typeof body.detail === 'string' ? body.detail : undefined,
      })
      return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'resolve-decision') {
      const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
      const decisionId = typeof body.decisionId === 'string' ? body.decisionId.trim() : ''
      const answer = typeof body.answer === 'string' ? body.answer.trim() : ''
      if (!taskId || !decisionId || !answer) return NextResponse.json({ error: 'taskId, decisionId, and answer are required' }, { status: 400 })
      const result = await resolveProtocolDecisionAdmin(runId, { taskId, decisionId, answer, deferred: body.deferred === true })
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (body.action === 'promote-learning') {
      const candidateId = typeof body.candidateId === 'string' ? body.candidateId.trim() : ''
      const target = body.target
      if (!candidateId || (target !== 'playbook' && target !== 'role' && target !== 'project_memory')) {
        return NextResponse.json({ error: 'candidateId and a valid target are required' }, { status: 400 })
      }
      const result = await promoteLearningCandidateAdmin(runId, { candidateId, target })
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json({ error: 'Unknown run action' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
