import { NextRequest, NextResponse } from 'next/server'
import { isProviderSelection } from '@/lib/provider'
import { getConfiguredProvider, setConfiguredProvider } from '@/lib/providerState'

export async function GET() {
  try {
    const provider = await getConfiguredProvider()
    return NextResponse.json({ provider })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const provider = body?.provider
  if (!isProviderSelection(provider)) {
    return NextResponse.json({ error: 'provider must be all, claude, codex, opencode, or copilot' }, { status: 400 })
  }

  try {
    await setConfiguredProvider(provider)
    return NextResponse.json({ ok: true, provider })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
