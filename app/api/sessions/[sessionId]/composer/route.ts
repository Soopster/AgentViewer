import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { prewarmViewSession, readViewSessionComposerOptions } from '@/lib/sessionBackend'
import type { ReasoningEffortLevel } from '@/lib/types'

const REASONING_EFFORT_LEVELS = new Set<ReasoningEffortLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
])

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const providerParam = new URL(request.url).searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined
  try {
    const options = await withProviderRequest(request, provider, undefined, () =>
      readViewSessionComposerOptions(sessionId, provider))
    return NextResponse.json(options)
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
  const provider = isAgentProvider(body?.provider) ? body.provider : undefined
  const cwd = typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : undefined
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const effort = REASONING_EFFORT_LEVELS.has(body?.effort as ReasoningEffortLevel)
    ? body.effort as ReasoningEffortLevel
    : undefined

  try {
    await withProviderRequest(request, provider, body, () => prewarmViewSession({
        sessionId,
        provider,
        cwd,
        model,
        effort,
        isPending: body?.isPending === true,
      }))
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
