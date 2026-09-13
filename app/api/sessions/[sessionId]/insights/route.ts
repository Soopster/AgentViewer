import { NextRequest, NextResponse } from 'next/server'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { isAgentProvider } from '@/lib/provider'
import { listViewSessionMessages, readViewSessionInfo } from '@/lib/sessionBackend'
import { CLAUDE_QUERY_ENV } from '@/lib/claudePool'
import { claudeProcessSpawnOptions } from '@/lib/claudeProcessSpawner'
import { buildThreadedMessages } from '@/lib/threading'
import { computeAnalytics } from '@/lib/analytics'
import { computeHealthReport } from '@/lib/healthScore'
import {
  buildCoachAggregate,
  buildCoachPrompt,
  COACH_INSIGHTS_OUTPUT_SCHEMA,
  parseCoachInsightValue,
  parseCoachInsights,
} from '@/lib/coachInsights'

export { maxDuration } from '@/lib/sessionBackend'

// Default to a fast, inexpensive model — coaching is an opt-in, structured task
// over a small aggregate, not a reasoning-heavy job.
const DEFAULT_COACH_MODEL = 'claude-haiku-4-5'

async function runCoachQuery(
  prompt: string,
  model: string,
  signal: AbortSignal,
): Promise<{ text: string; structuredOutput?: unknown }> {
  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const q = query({
      prompt,
      options: {
        env: CLAUDE_QUERY_ENV,
        model,
        maxTurns: 1,
        persistSession: false,
        // No tools — the model only ever sees the aggregate text we hand it.
        allowedTools: [],
        permissionMode: 'default',
        abortController,
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
        outputFormat: { type: 'json_schema', schema: COACH_INSIGHTS_OUTPUT_SCHEMA },
        ...claudeProcessSpawnOptions(),
      },
    })
    let text = ''
    let structuredOutput: unknown
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') text += block.text
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
          text = msg.result
        }
        if (msg.subtype === 'success' && msg.structured_output !== undefined) {
          structuredOutput = msg.structured_output
        }
        break
      }
    }
    return { text, structuredOutput }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = isAgentProvider(body?.provider) ? body.provider : undefined
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_COACH_MODEL

  try {
    const [info, rawMessages] = await Promise.all([
      readViewSessionInfo(sessionId, provider),
      listViewSessionMessages(sessionId, { limit: 100_000, offset: 0 }, provider),
    ])
    if (!info) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const threadedMessages = buildThreadedMessages(rawMessages)
    const analyticsInput = { info, threadedMessages, rawMessages }
    const analytics = computeAnalytics(analyticsInput)
    const health = computeHealthReport(analyticsInput)
    const aggregate = buildCoachAggregate(analytics, health)

    const prompt = buildCoachPrompt(aggregate)
    const result = await runCoachQuery(prompt, model, request.signal)
    const insights = result.structuredOutput === undefined
      ? parseCoachInsights(result.text)
      : parseCoachInsightValue(result.structuredOutput)

    if (insights.length === 0) {
      return NextResponse.json(
        { error: 'The coaching model returned no usable insights. Try again.', aggregate },
        { status: 502 },
      )
    }

    return NextResponse.json({ sessionId, model, aggregate, insights })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
