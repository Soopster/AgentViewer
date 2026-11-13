import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { sessionProvenanceSummary } from '@/lib/provenance'
import { getConfiguredProvider } from '@/lib/providerState'

// Session-side provenance: GET /api/sessions/[sessionId]/provenance?provider=…
// Lists the files this session wrote and how many of their current lines
// still trace back to it.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const providerParam = new URL(request.url).searchParams.get('provider')
  const configured = isAgentProvider(providerParam) ? providerParam : await getConfiguredProvider()
  const provider = isAgentProvider(configured) ? configured : 'claude'
  try {
    const result = await sessionProvenanceSummary(provider, sessionId)
    // `edits=1` adds the recorded edits with their prompts (the Files touched view).
    if (new URL(request.url).searchParams.get('edits') === '1') {
      const { readFileEditsForSession } = await import('@/lib/sessionPersistence')
      return NextResponse.json({ ...result, edits: await readFileEditsForSession(provider, sessionId) })
    }
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
