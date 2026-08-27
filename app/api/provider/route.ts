import { NextRequest, NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { listProviderInstanceSummaries, resolveProviderInstance } from '@/lib/providerInstances'
import { getConfiguredProviderTarget, setConfiguredProviderTarget } from '@/lib/providerState'

export async function GET() {
  try {
    const [target, instances] = await Promise.all([
      getConfiguredProviderTarget(),
      listProviderInstanceSummaries(),
    ])
    return NextResponse.json({ ...target, instances })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const provider = body?.provider
  if (!isProviderSelection(provider)) {
    return NextResponse.json({
      error: 'provider must be all, claude, codex, opencode, copilot, pi, lmstudio, claude-acp, or codex-acp',
    }, { status: 400 })
  }

  try {
    const providerInstanceId = provider === 'all'
      ? undefined
      : (await resolveProviderInstance(
          typeof body?.providerInstanceId === 'string' ? body.providerInstanceId : undefined,
          provider,
        )).id
    await setConfiguredProviderTarget({ provider, ...(providerInstanceId ? { providerInstanceId } : {}) })
    return NextResponse.json({ ok: true, provider, ...(providerInstanceId ? { providerInstanceId } : {}) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
