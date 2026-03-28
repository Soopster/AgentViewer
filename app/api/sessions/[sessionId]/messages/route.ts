import { NextRequest, NextResponse } from 'next/server'
import { getSessionMessages, unstable_v2_resumeSession } from '@anthropic-ai/claude-agent-sdk'

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

  const stream = new ReadableStream({
    async start(controller) {
      const session = unstable_v2_resumeSession(sessionId, { model })
      try {
        await session.send(userMessage)
        for await (const msg of session.stream()) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
      } finally {
        session.close()
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
