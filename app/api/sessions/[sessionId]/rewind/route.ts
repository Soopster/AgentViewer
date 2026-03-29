import { NextRequest, NextResponse } from 'next/server'
import { rewindOrRollbackViewSession } from '@/lib/sessionBackend'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))

  try {
    const result = await rewindOrRollbackViewSession({ sessionId, body })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.includes('required') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
