import { NextRequest, NextResponse } from 'next/server'
import { createSessionControlQuery } from '@/lib/sdkControlQuery'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const q = createSessionControlQuery(sessionId)

  try {
    await q.initializationResult()
    const [models, contextUsage] = await Promise.all([
      q.supportedModels(),
      q.getContextUsage().catch(() => null),
    ])
    return NextResponse.json({
      models,
      currentModel: contextUsage?.model ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    q.close()
  }
}
