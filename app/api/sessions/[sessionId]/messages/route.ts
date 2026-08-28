import { NextRequest, NextResponse } from 'next/server'
import { drainCooperativeInbox, observeCoordinatorSessionTurn } from '@/lib/agentCoordination'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { listViewSessionMessageWindow, streamViewSessionTurn } from '@/lib/sessionBackend'

export { maxDuration } from '@/lib/sessionBackend'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10)
  const maxLimit = searchParams.get('all') === '1' ? 100_000 : 2000
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 500, maxLimit)
  const rawOffset = parseInt(searchParams.get('offset') ?? '', 10)
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  const tail = searchParams.get('tail') === '1'
  // Optional cursor check: the uuid the client believes sits at `offset`. A
  // mismatch means the transcript was rewritten under it, and the response
  // comes back as a replace-tail. See MessageListParams.expectUuid.
  const expectUuid = searchParams.get('expectUuid') || undefined
  const providerParam = searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined

  try {
    const window = await withProviderRequest(request, provider, undefined, () =>
      listViewSessionMessageWindow(sessionId, { limit, offset, tail, expectUuid }, provider))
    return NextResponse.json({ sessionId, provider, ...window }, {
      headers: { 'Cache-Control': 'private, max-age=2, stale-while-revalidate=8' },
    })
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
  // Cooperative Coordinator join (see lib/agentCoordination.ts): if this
  // session is bound to a run, fold in anything the room said since the
  // user's last turn before the message goes out. No-ops instantly for the
  // overwhelming majority of sessions that were never joined to a run.
  if (typeof body?.message === 'string') {
    const drained = await drainCooperativeInbox(sessionId).catch(() => '')
    if (drained) body.message = `${body.message}\n${drained}`
  }
  const response = await withProviderRequest(request, provider, body, () =>
    streamViewSessionTurn({ sessionId, signal: request.signal, body, provider }))
  return observeCoordinatorSessionTurn(sessionId, response)
}
