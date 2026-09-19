import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { forkViewSession } from '@/lib/sessionBackend'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = isAgentProvider(body?.provider) ? body.provider : undefined
  try {
    const result = await withProviderRequest(request, provider, body, () =>
      forkViewSession({ sessionId, body, provider }))
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
