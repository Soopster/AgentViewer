import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { currentProviderInstanceId } from '@/lib/providerInstances'
import { getConfiguredProvider } from '@/lib/providerState'
import { SESSION_GOAL_STATUSES, type SessionGoalStatus } from '@/lib/sessionGoals'
import {
  createSessionGoal,
  patchSessionGoal,
  readSessionGoal,
  removeSessionGoal,
} from '@/lib/sessionGoalStore'
import { ensureSessionGoalEngine, wakeSessionGoal } from '@/lib/sessionGoalEngine'
import type { AgentProvider } from '@/lib/types'

/**
 * One session goal per session + provider account.
 *
 *   GET    → { goal }          current goal (null when unset)
 *   POST   → { goal }          create/replace: objective, optional tokenBudget
 *   PATCH  → { goal }          pause/resume, edit objective or budget
 *   DELETE → { ok }            remove the goal entirely
 *
 * The goal itself is a local note; the engine in lib/sessionGoalEngine.ts does
 * the continuation work.
 */

async function resolveProvider(request: NextRequest, body: Record<string, unknown>): Promise<AgentProvider> {
  if (isAgentProvider(body.provider)) return body.provider
  const param = new URL(request.url).searchParams.get('provider')
  if (isAgentProvider(param)) return param
  const configured = await getConfiguredProvider()
  return configured === 'all' ? 'claude' : configured
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const provider = await resolveProvider(request, {})
  try {
    const goal = await withProviderRequest(request, provider, undefined, () => readSessionGoal({
      provider,
      providerInstanceId: currentProviderInstanceId(provider),
      sessionId,
    }))
    // Re-arm the observer after a server restart: the goal is still active in
    // the file, but the process that would nudge it is new.
    ensureSessionGoalEngine()
    return NextResponse.json({ goal })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = await resolveProvider(request, body)
  const objective = typeof body?.objective === 'string' ? body.objective.trim() : ''
  if (!objective) return NextResponse.json({ error: 'objective is required' }, { status: 400 })
  const tokenBudget = typeof body?.tokenBudget === 'number' && Number.isFinite(body.tokenBudget) && body.tokenBudget > 0
    ? Math.floor(body.tokenBudget)
    : null
  const maxContinuations = typeof body?.maxContinuations === 'number' && Number.isFinite(body.maxContinuations) && body.maxContinuations > 0
    ? Math.floor(body.maxContinuations)
    : undefined
  try {
    const goal = await withProviderRequest(request, provider, body, async () => {
      const target = {
        provider,
        providerInstanceId: currentProviderInstanceId(provider),
        sessionId,
      }
      const created = await createSessionGoal({ target, objective, tokenBudget, maxContinuations })
      ensureSessionGoalEngine()
      return created
    })
    return NextResponse.json({ goal })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = await resolveProvider(request, body)
  const status = SESSION_GOAL_STATUSES.includes(body?.status as SessionGoalStatus)
    ? body.status as SessionGoalStatus
    : undefined
  const objective = typeof body?.objective === 'string' && body.objective.trim() ? body.objective.trim() : undefined
  const tokenBudget = body?.tokenBudget === null
    ? null
    : typeof body?.tokenBudget === 'number' && Number.isFinite(body.tokenBudget) && body.tokenBudget > 0
      ? Math.floor(body.tokenBudget)
      : undefined
  const lastNote = typeof body?.lastNote === 'string' && body.lastNote.trim() ? body.lastNote.trim() : undefined
  try {
    const goal = await withProviderRequest(request, provider, body, async () => {
      const target = {
        provider,
        providerInstanceId: currentProviderInstanceId(provider),
        sessionId,
      }
      const existing = await readSessionGoal(target)
      if (!existing) return null
      const resumed = status === 'active' && existing.status !== 'active'
      const updated = await patchSessionGoal(target, {
        ...(status ? { status } : {}),
        ...(objective ? { objective } : {}),
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        ...(lastNote ? { lastNote } : {}),
        ...(status === 'active' ? { error: null } : {}),
      })
      if (resumed && updated) {
        ensureSessionGoalEngine()
        // The turn that paused the goal already settled; resume must not wait
        // for the next manual message.
        wakeSessionGoal(target)
      }
      return updated
    })
    if (!goal) return NextResponse.json({ error: 'No goal for this session' }, { status: 404 })
    return NextResponse.json({ goal })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = await resolveProvider(request, body)
  try {
    const removed = await withProviderRequest(request, provider, body, () => removeSessionGoal({
      provider,
      providerInstanceId: currentProviderInstanceId(provider),
      sessionId,
    }))
    return NextResponse.json({ ok: removed })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
