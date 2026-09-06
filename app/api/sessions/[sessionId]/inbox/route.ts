import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { providerInstanceIdFromRequest } from '@/lib/providerRequest'
import { resolveProviderInstance } from '@/lib/providerInstances'
import { readSessionInboxState, updateSessionInboxState, type SessionInboxAction } from '@/lib/sessionInbox'
import type { LinkedPullRequest } from '@/lib/types'

const ACTIONS = new Set<SessionInboxAction>([
  'pin', 'unpin', 'settle', 'reopen', 'snooze', 'unsnooze', 'link-pr', 'unlink-pr',
])

/** Accepts only the fields a client is allowed to set; `state`/`checkedAt` are
 *  the sweep's to write, never the caller's. */
function parseLinkedPr(value: unknown): LinkedPullRequest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const number = Number(raw.number)
  if (typeof raw.repo !== 'string' || !raw.repo || !Number.isSafeInteger(number) || number <= 0) return undefined
  return {
    repo: raw.repo,
    number,
    url: typeof raw.url === 'string' ? raw.url : '',
    cwd: typeof raw.cwd === 'string' && raw.cwd ? raw.cwd : undefined,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const query = new URL(request.url).searchParams
  const rawProvider = query.get('provider')
  const provider = isAgentProvider(rawProvider) ? rawProvider : undefined
  if (!provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  try {
    const instance = await resolveProviderInstance(query.get('providerInstanceId') || undefined, provider)
    return NextResponse.json({
      sessionId,
      provider,
      providerInstanceId: instance.id,
      inbox: await readSessionInboxState(provider, sessionId, instance.id),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to read inbox state' }, { status: 400 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const provider = isAgentProvider(body.provider) ? body.provider : undefined
  const action = typeof body.action === 'string' && ACTIONS.has(body.action as SessionInboxAction)
    ? body.action as SessionInboxAction
    : undefined
  if (!provider || !action) return NextResponse.json({ error: 'provider and a valid inbox action are required' }, { status: 400 })
  if (action === 'link-pr' && !parseLinkedPr(body.linkedPr)) {
    return NextResponse.json({ error: 'link-pr requires linkedPr { repo, number }' }, { status: 400 })
  }
  try {
    const instance = await resolveProviderInstance(providerInstanceIdFromRequest(request, body), provider)
    const inbox = await updateSessionInboxState({
      provider,
      sessionId,
      providerInstanceId: instance.id,
      action,
      snoozedUntil: typeof body.snoozedUntil === 'number' ? body.snoozedUntil : undefined,
      linkedPr: parseLinkedPr(body.linkedPr),
    })
    return NextResponse.json({ ok: true, sessionId, provider, providerInstanceId: instance.id, inbox })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update inbox state' }, { status: 400 })
  }
}
