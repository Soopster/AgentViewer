import { NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { readInteractiveTeardown } from '@/lib/agentCoordination'

/** What turning this team off would leave behind. Read when the user asks to
 *  turn it off, never on a poll: it runs `git status` per teammate checkout. */
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const provider = new URL(request.url).searchParams.get('provider')
  if (!provider || !isAgentProvider(provider)) return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  try {
    return NextResponse.json(await readInteractiveTeardown(sessionId, provider), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not inspect teammate checkouts' }, { status: 500 })
  }
}
