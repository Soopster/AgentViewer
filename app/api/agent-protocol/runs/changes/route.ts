import { NextRequest } from 'next/server'
import { subscribeProtocolRunChanges } from '@/lib/agentCoordination'

export const dynamic = 'force-dynamic'
const NOOP = () => {}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  let cleanup = NOOP
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        request.signal.removeEventListener('abort', close)
        try { controller.close() } catch {}
      }
      const enqueue = (chunk: string) => {
        if (closed) return
        try { controller.enqueue(encoder.encode(chunk)) } catch { close() }
      }
      const unsubscribe = subscribeProtocolRunChanges((runId) => {
        enqueue(`data: ${JSON.stringify({ runId })}\n\n`)
      })
      const heartbeat = setInterval(() => { enqueue(': heartbeat\n\n') }, 15_000)
      heartbeat.unref?.()
      request.signal.addEventListener('abort', close, { once: true })
      enqueue(': connected\n\n')
      cleanup = close
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  })
}
