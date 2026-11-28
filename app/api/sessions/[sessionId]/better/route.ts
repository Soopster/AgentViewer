import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { withProviderRequest } from '@/lib/providerRequest'
import { currentProviderInstanceId } from '@/lib/providerInstances'
import { researchBetterPrompt } from '@/lib/promptResearch'
export const maxDuration = 1200
export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const body = await request.json().catch(() => null)
  if (!body || !isAgentProvider(body.provider) || typeof body.draft !== 'string' || body.draft.length > 80_000) return NextResponse.json({ error: 'A provider and a draft of at most 80,000 characters are required.' }, { status: 400 })
  const { sessionId } = await params
  const lifetime = new AbortController()
  const signal = AbortSignal.any([request.signal, lifetime.signal])
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      const emit = (type: string, value: unknown) => { if (!signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, value })}\n\n`)) }
      void withProviderRequest(request, body.provider, body, async () => {
        try {
          const result = await researchBetterPrompt({ sessionId, cwd: typeof body.cwd === 'string' ? body.cwd : undefined, provider: body.provider, providerInstanceId: currentProviderInstanceId(body.provider) }, body.draft, signal, progress => emit('progress', progress))
          emit('result', result)
        } catch (error) { emit('error', error instanceof Error ? error.message : 'Prompt research failed') }
        finally { try { controller.close() } catch { /* cancelled */ } }
      }).catch(error => { try { emit('error', error instanceof Error ? error.message : 'Provider unavailable'); controller.close() } catch { /* cancelled */ } })
    },
    cancel() { lifetime.abort() },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } })
}
