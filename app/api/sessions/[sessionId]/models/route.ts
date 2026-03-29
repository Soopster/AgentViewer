import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { readViewSessionModels } from '@/lib/sessionBackend'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const providerParam = new URL(request.url).searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined
  try {
    const { models, currentModel } = await readViewSessionModels(sessionId, provider)
    return NextResponse.json({
      models,
      currentModel,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
