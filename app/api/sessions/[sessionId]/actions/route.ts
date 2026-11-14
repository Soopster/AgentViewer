import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { isPendingRequestGone, PENDING_REQUEST_GONE_CODE } from '@/lib/pendingRequestGone'
import { runViewSessionAction } from '@/lib/sessionBackend'

export { maxDuration } from '@/lib/sessionBackend'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = isAgentProvider(body?.provider) ? body.provider : undefined

  try {
    const result = await withProviderRequest(request, provider, body, () =>
      runViewSessionAction({ sessionId, body, provider }))
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (isPendingRequestGone(err)) return NextResponse.json({ error: message, code: PENDING_REQUEST_GONE_CODE }, { status: 410 })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
