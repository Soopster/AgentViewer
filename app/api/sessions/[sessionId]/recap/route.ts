import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { currentProviderInstanceId } from '@/lib/providerInstances'
import { getConfiguredProvider } from '@/lib/providerState'
import { ensureSessionRecapEngine, generateRecap } from '@/lib/sessionRecapEngine'
import { readSessionRecap, readSessionRecapsEnabled, removeSessionRecap } from '@/lib/sessionRecapStore'
import type { AgentProvider } from '@/lib/types'

/**
 * The idle recap for one session + provider account.
 *
 *   GET    → { enabled, recap }   stored recap (null when none)
 *   POST   → { recap }            write one now instead of waiting for quiet
 *   DELETE → { ok }               dismiss it
 *
 * The engine in lib/sessionRecapEngine.ts writes recaps on its own; session
 * lists carry the fresh ones as `session.recap`.
 */

async function resolveProvider(request: NextRequest, body: Record<string, unknown>): Promise<AgentProvider> {
  if (isAgentProvider(body.provider)) return body.provider
  const param = new URL(request.url).searchParams.get('provider')
  if (isAgentProvider(param)) return param
  const configured = await getConfiguredProvider()
  return configured === 'all' ? 'claude' : configured
}

type Params = { params: Promise<{ sessionId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const provider = await resolveProvider(request, {})
  try {
    return NextResponse.json(await withProviderRequest(request, provider, undefined, async () => {
      const enabled = await readSessionRecapsEnabled()
      if (enabled) ensureSessionRecapEngine()
      const recap = await readSessionRecap({ provider, providerInstanceId: currentProviderInstanceId(provider), sessionId })
      return { enabled, recap }
    }))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = await resolveProvider(request, body)
  try {
    const result = await withProviderRequest(request, provider, body, async () => {
      if (!(await readSessionRecapsEnabled())) return { error: 'Recaps are turned off', status: 409 }
      const providerInstanceId = currentProviderInstanceId(provider)
      const recap = await generateRecap({ provider, ...(providerInstanceId ? { providerInstanceId } : {}), sessionId })
      return recap ? { recap } : { error: 'Nothing to summarize yet', status: 409 }
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ recap: result.recap })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const provider = await resolveProvider(request, {})
  try {
    const ok = await withProviderRequest(request, provider, undefined, () => removeSessionRecap({
      provider,
      providerInstanceId: currentProviderInstanceId(provider),
      sessionId,
    }))
    return NextResponse.json({ ok })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
