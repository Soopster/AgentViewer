import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAgentProvider } from '@/lib/provider'
import { readCoordinatorResultReview, integrateCoordinatorResult } from '@/lib/coordinatorResultReviewServer'

type Context = { params: Promise<{ sessionId: string; taskId: string }> }
export async function GET(request: Request, { params }: Context) {
  const provider = new URL(request.url).searchParams.get('provider')
  if (!isAgentProvider(provider)) return NextResponse.json({ error: 'provider is required' }, { status: 400 })
  try {
    const { sessionId, taskId } = await params
    return NextResponse.json(await readCoordinatorResultReview(sessionId, provider, taskId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 409 }) }
}
const schema = z.object({ provider: z.string().refine(isAgentProvider), token: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().min(1).max(160) })
export async function POST(request: Request, { params }: Context) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide the reviewed revision and request ID' }, { status: 400 })
  try {
    const { sessionId, taskId } = await params
    return NextResponse.json(await integrateCoordinatorResult(sessionId, parsed.data.provider, taskId, parsed.data.token, parsed.data.requestId))
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) }
}
