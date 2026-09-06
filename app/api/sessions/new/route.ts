import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { createNewViewSession } from '@/lib/sessionBackend'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    provider?: unknown
    providerInstanceId?: unknown
    cwd?: unknown
    title?: unknown
  }
  const provider = isAgentProvider(body.provider) ? body.provider : undefined
  const cwd = typeof body.cwd === 'string' ? body.cwd : undefined
  const title = typeof body.title === 'string' ? body.title : undefined
  try {
    const result = await withProviderRequest(request, provider, body as Record<string, unknown>, () =>
      createNewViewSession({ provider, cwd, title }))
    return NextResponse.json({ ...result, providerInstanceId: body.providerInstanceId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
