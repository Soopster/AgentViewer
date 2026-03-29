import { NextRequest, NextResponse } from 'next/server'
import { getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'

// Allow long-running Claude responses (up to 5 min)
export const maxDuration = 300

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 2000)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  try {
    const messages = await getSessionMessages(sessionId, { limit, offset })
    return NextResponse.json({ messages })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json()
  const userMessage: string = body.message
  const model: string = body.model ?? 'claude-sonnet-4-6'

  if (!userMessage?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const abortController = new AbortController()
  request.signal.addEventListener('abort', () => abortController.abort())

  const stream = new ReadableStream({
    async start(controller) {
      const q = query({ prompt: userMessage, options: { resume: sessionId, model, abortController } })
      try {
        // Emit context usage snapshot before the response begins
        try {
          const usage = await q.getContextUsage()
          controller.enqueue(encoder.encode(`event: context-usage\ndata: ${JSON.stringify(usage)}\n\n`))
        } catch { /* not available yet — skip */ }

        for await (const msg of q) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          // Client cancelled — clean exit, no error event
        } else {
          const message = err instanceof Error ? err.message : 'Unknown error'
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
