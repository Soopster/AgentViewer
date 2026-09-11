import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAgentProvider } from '@/lib/provider'
import { readViewSessionInfo } from '@/lib/sessionBackend'
import { createExternalProtocolTask, ensureSessionCoordinator, readSessionCoordinator, reviewExternalProtocolPlan, runExternalProtocolIdempotent, sendExternalProtocolMessage, sessionCoordinatorIdentity, resolveProtocolDecisionAdmin } from '@/lib/agentCoordination'

const schema = z.object({
  provider: z.string().refine(isAgentProvider),
  requestId: z.string().min(1).max(160),
  action: z.enum(['delegate', 'message', 'review-plan', 'decision']),
  detail: z.string().trim().min(1).max(8000),
  to: z.string().min(1).max(160).optional(),
  paths: z.array(z.string().trim().min(1)).max(100).optional(),
  taskId: z.string().min(1).optional(), decisionId: z.string().min(1).optional(),
  approved: z.boolean().optional(), inReplyTo: z.string().min(1).optional(),
})

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const provider = new URL(request.url).searchParams.get('provider')
  if (!isAgentProvider(provider)) return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  const { sessionId } = await params
  return NextResponse.json({ snapshot: await readSessionCoordinator(sessionId, provider) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide an action, task text, provider, and stable request ID' }, { status: 400 })
  const body = parsed.data
  const { sessionId } = await params
  try {
    if (body.action === 'delegate') {
      const info = await readViewSessionInfo(sessionId, body.provider)
      if (!info?.cwd) throw new Error('Open a local project conversation before delegating')
      await ensureSessionCoordinator({ sessionId, provider: body.provider, cwd: info.cwd })
    }
    const identity = await sessionCoordinatorIdentity(sessionId, body.provider)
    const result = await runExternalProtocolIdempotent(identity, `chat_${body.action}`, body.requestId, async () => {
      if (body.action === 'delegate') return createExternalProtocolTask(identity, {
        assignTo: body.to ?? 'auto', title: body.detail.split('\n')[0]!.slice(0, 160), detail: body.detail, paths: body.paths,
      })
      if (body.action === 'message') {
        if (!body.to) throw new Error('Choose a teammate')
        return sendExternalProtocolMessage(identity, { to: body.to, body: body.detail, inReplyTo: body.inReplyTo, kind: body.inReplyTo ? 'response' : 'request' })
      }
      if (!body.taskId) throw new Error('taskId is required')
      if (body.action === 'review-plan') {
        if (body.approved === undefined) throw new Error('Choose approve or reject')
        return reviewExternalProtocolPlan(identity, { taskId: body.taskId, approved: body.approved, summary: body.detail })
      }
      if (!body.decisionId) throw new Error('decisionId is required')
      return resolveProtocolDecisionAdmin(identity.runId, { taskId: body.taskId, decisionId: body.decisionId, answer: body.detail })
    })
    return NextResponse.json({ result, snapshot: await readSessionCoordinator(sessionId, body.provider) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Coordination request failed' }, { status: 409 })
  }
}
