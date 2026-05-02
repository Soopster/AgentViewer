import { NextRequest } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { listViewSessionMessages } from '@/lib/sessionBackend'
import type { SessionMessage } from '@/lib/types'

export const maxDuration = 300

const DEFAULT_STREAM_LIMIT = 220
const MAX_STREAM_LIMIT = 500
const DEFAULT_BACKFILL = 20
const MAX_BACKFILL = 100
const MESSAGE_STREAM_POLL_MS = 1500
const HEARTBEAT_MS = 20_000

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseOffset(value: string | null): number {
  const parsed = parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function apiMessageSignature(message: SessionMessage): string {
  const originKind = message.origin?.kind ?? ''
  const turnId = message.turnId ?? ''
  const timestamp = message.timestamp ?? ''
  let payload = ''
  try {
    payload = JSON.stringify(message.message)
  } catch {
    payload = String(message.message)
  }
  return [message.uuid, message.type, timestamp, originKind, turnId, payload].join('|')
}

function messageWindowSignature(offset: number, messages: SessionMessage[]): string {
  return `${offset}:${messages.length}:${messages.map(apiMessageSignature).join('\n')}`
}

function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = () => {
      clearTimeout(timeout)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const providerParam = searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined
  const limit = parsePositiveInt(searchParams.get('limit'), DEFAULT_STREAM_LIMIT, MAX_STREAM_LIMIT)
  const backfill = parsePositiveInt(searchParams.get('backfill'), DEFAULT_BACKFILL, MAX_BACKFILL)
  let offset = parseOffset(searchParams.get('offset'))

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          /* stream was already closed by the runtime */
        }
      }

      const pump = async () => {
        let lastSignature = ''
        let lastHeartbeat = Date.now()

        while (!closed && !request.signal.aborted) {
          try {
            const messages = await listViewSessionMessages(
              sessionId,
              { offset, limit, tail: false },
              provider,
            )
            const signature = messageWindowSignature(offset, messages)
            if (messages.length > 0 && signature !== lastSignature) {
              enqueue('messages', { offset, messages })
              lastSignature = signature
              offset = Math.max(0, offset + messages.length - backfill)
            }

            const now = Date.now()
            if (now - lastHeartbeat >= HEARTBEAT_MS) {
              enqueue('heartbeat', { ts: now })
              lastHeartbeat = now
            }

            const shouldContinue = await wait(MESSAGE_STREAM_POLL_MS, request.signal)
            if (!shouldContinue) break
          } catch (err) {
            enqueue('error', { error: err instanceof Error ? err.message : 'Unknown error' })
            break
          }
        }

        close()
      }

      void pump()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
