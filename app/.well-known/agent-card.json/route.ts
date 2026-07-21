import { NextResponse } from 'next/server'
import { buildCoordinatorAgentCard } from '@/lib/a2aAdapter'

// A2A Protocol discovery (spec §5): the Agent Card describing this
// Coordinator, served from the well-known path any A2A client checks first.
export async function GET(request: Request) {
  const baseUrl = new URL(request.url).origin
  return NextResponse.json(buildCoordinatorAgentCard(baseUrl), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
