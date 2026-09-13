import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { getViewSubagentMessages } from '@/lib/sessionBackend'

export { maxDuration } from '@/lib/sessionBackend'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; agentId: string }> },
) {
  const { sessionId, agentId } = await params
  const providerParam = new URL(request.url).searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined

  try {
    const messages = await getViewSubagentMessages(sessionId, agentId, provider)
    return NextResponse.json({ messages })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
