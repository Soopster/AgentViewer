import { NextResponse } from 'next/server'
import { z } from 'zod'
import { delegateProtocolTaskAdmin } from '@/lib/agentCoordination'

const requestSchema = z.object({
  detail: z.string().trim().min(1).max(8000),
  to: z.string().trim().min(1).max(160).optional(),
  paths: z.array(z.string().trim().min(1)).max(100).optional(),
  requestId: z.string().min(1).max(160),
})

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide a task, valid paths, and a request ID.' }, { status: 400 })
  const { runId } = await params
  try {
    return NextResponse.json(await delegateProtocolTaskAdmin(runId, parsed.data), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not delegate task' }, { status: 409 })
  }
}
