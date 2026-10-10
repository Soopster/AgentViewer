import { getPiActivitySnapshot, subscribeToPiActivity } from '@/lib/piActivity'

export const dynamic = 'force-dynamic'
export const maxDuration = 3600

const HEARTBEAT_MS = 20_000

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function createActivityStream(request: Request): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let closed = false
  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(frame('activity', getPiActivitySnapshot())))
        } catch {
          close()
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        if (heartbeat) clearInterval(heartbeat)
        try { controller.close() } catch { /* already closed */ }
      }

      send()
      unsubscribe = subscribeToPiActivity(send)
      heartbeat = setInterval(() => {
        if (closed) return
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch { close() }
      }, HEARTBEAT_MS)
      if (typeof heartbeat === 'object' && 'unref' in heartbeat) heartbeat.unref()
      request.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      closed = true
      unsubscribe()
      if (heartbeat) clearInterval(heartbeat)
    },
  })
}

export async function GET(request: Request) {
  return new Response(createActivityStream(request), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
