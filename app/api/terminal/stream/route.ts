import type { NextRequest } from 'next/server'
import {
  openTerminalSession,
  subscribeTerminal,
  unsubscribeTerminal,
  type Subscriber,
  type TerminalState,
} from '@/lib/terminalSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clamp2(value: string | null, fallback: number): number {
  return value ? Math.max(2, Math.min(500, Math.round(Number(value) || fallback))) : fallback
}

/**
 * Server-Sent Events stream for one embedded-terminal session. The first
 * client to connect spawns the PTY/TUI; output and lifecycle events are
 * framed as:
 *
 *   event: out\n    data: <base64 chunk>\n\n
 *   event: state\n  data: {"state":"running"|"exited"|"error",...}\n\n
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('session')
  const cols = clamp2(searchParams.get('cols'), 80)
  const rows = clamp2(searchParams.get('rows'), 24)
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return new Response('bad session id', { status: 400 })
  }

  const opened = openTerminalSession(id, cols, rows)
  if (opened.state === 'error') {
    return new Response(opened.message, { status: 500 })
  }

  const encoder = new TextEncoder()
  const stateEnvelope = (event: TerminalState): Uint8Array => {
    const line = `event: state\ndata: ${JSON.stringify(event)}\n\n`
    return encoder.encode(line)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sub: Subscriber = {
        push: (chunk) => {
          const b64 = Buffer.from(chunk).toString('base64')
          controller.enqueue(encoder.encode(`event: out\ndata: ${b64}\n\n`))
        },
        status: (event) => controller.enqueue(stateEnvelope(event)),
      }
      const { replay, state } = subscribeTerminal(id, sub)
      for (const chunk of replay) sub.push(chunk)
      controller.enqueue(stateEnvelope(state))

      request.signal.addEventListener('abort', () => {
        unsubscribeTerminal(id, sub)
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      // abort handler does the cleanup
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}