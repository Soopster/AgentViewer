import { NextRequest, NextResponse } from 'next/server'
import { createSessionControlQuery } from '@/lib/sdkControlQuery'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const userMessageId: string | undefined = body.userMessageId
  const model: string = body.model ?? 'claude-sonnet-4-6'

  if (!userMessageId) {
    return NextResponse.json({ error: 'userMessageId is required' }, { status: 400 })
  }

  const q = createSessionControlQuery(sessionId, model)

  try {
    await q.initializationResult()
    const result = await q.rewindFiles(userMessageId, { dryRun: Boolean(body.dryRun) })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    q.close()
  }
}
