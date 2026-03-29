import { NextRequest, NextResponse } from 'next/server'
import { readViewSessionDiagnostics } from '@/lib/sessionBackend'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  try {
    const { sections, currentModel } = await readViewSessionDiagnostics(sessionId)
    return NextResponse.json({
      sections,
      currentModel,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
