import { NextRequest, NextResponse } from 'next/server'
import { readViewSessionModels } from '@/lib/sessionBackend'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    const { models, currentModel } = await readViewSessionModels(sessionId)
    return NextResponse.json({
      models,
      currentModel,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
