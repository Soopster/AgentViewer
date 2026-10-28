import { NextRequest } from 'next/server'
import { subscribeProtocolRunChanges } from '@/lib/agentCoordination'

export const dynamic = 'force-dynamic'
const NOOP = () => {}

/**
 * How long a subscriber may accept nothing before it is dropped — herdr
 * disconnects a terminal observer that makes no write progress for 30s
 * (#3612), because one stalled reader must not cost the server memory for the
 * life of the process. Every run change and every heartbeat queues here, so a
 * client that stops reading and never disconnects (a suspended laptop, a
 * wedged tab) grows this stream's buffer without bound. Its pane — the team —
 * keeps running; only the observer is dropped, and clients reconnect.
 */
const STALLED_SUBSCRIBER_MS = Number(process.env.AGENT_VIEWER_SSE_STALL_MS) || 30_000

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
      // Null desiredSize means the consumer errored; <= 0 means it is not
      // draining. Progress clears the timer, so a slow reader is fine and only
      // a stopped one is dropped.
      let stalledSince: number | null = null
      const enqueue = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
          const desired = controller.desiredSize
          if (desired !== null && desired > 0) stalledSince = null
          else {
            stalledSince ??= Date.now()
            if (Date.now() - stalledSince >= STALLED_SUBSCRIBER_MS) close()
          }
        } catch { close() }
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
