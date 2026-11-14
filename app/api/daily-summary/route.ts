import { NextResponse } from 'next/server'
import { DAILY_SUMMARY_RANGES, type DailySummaryRange, type DailySummaryWaitingInput } from '@/lib/dailySummary'
import { readViewRuntimeActivity } from '@/lib/sessionActivity'

// What every agent did over a range, for the Web daily summary plugin. The
// waiting items are this server's own: pending approvals and questions on its
// running turns, and viewer attention notes.
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('range')
  const range = (DAILY_SUMMARY_RANGES as readonly string[]).includes(requested ?? '') ? requested as DailySummaryRange : 'today'
  const activity = readViewRuntimeActivity()
  const waiting: DailySummaryWaitingInput[] = [
    ...activity.running.flatMap(turn => [
      ...turn.pendingPermissions.map(permission => ({ provider: turn.provider, sessionId: turn.sessionId, kind: 'permission' as const, text: pendingText(permission, 'approval') })),
      ...turn.pendingPrompts.map(prompt => ({ provider: turn.provider, sessionId: turn.sessionId, kind: 'question' as const, text: pendingText(prompt, 'question') })),
    ]),
    ...activity.attention.map(note => ({ provider: note.provider, sessionId: note.sessionId, kind: 'viewer-note' as const, text: note.title })),
  ]
  try {
    const { readDailySummary } = await import('@/lib/dailySummaryReader')
    return NextResponse.json(await readDailySummary({ range, waiting }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the summary' }, { status: 500 })
  }
}

function pendingText(payload: Record<string, unknown>, fallback: string): string {
  for (const key of ['title', 'question', 'toolName', 'tool', 'message']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200)
  }
  return fallback
}
