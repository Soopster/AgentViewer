import { NextRequest, NextResponse } from 'next/server'
import { listViewSessionMessages, streamViewSessionTurn } from '@/lib/sessionBackend'

export { maxDuration } from '@/lib/sessionBackend'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 2000)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  try {
    const messages = await listViewSessionMessages(sessionId, { limit, offset })
    return NextResponse.json({ messages })
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
  return streamViewSessionTurn({ sessionId, request, body })
}
