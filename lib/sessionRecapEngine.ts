// Session recaps — the engine.
//
// A settled turn arms a quiet-period timer; any activity on the session in the
// meantime means the user is still working and the recap is not wanted. When
// the timer fires, one cheap model call reads the last few turns and the result
// is stored for the session list and the composer to show. Process-local state
// is guarded on globalThis, like lib/sessionGoalEngine.ts, so a Next dev reload
// cannot double-schedule.

import { runStructuredQuery } from './oneShotLlm'
import { withProviderInstance } from './providerInstances'
import { isSessionGoalLive } from './sessionGoals'
import { readSessionGoal } from './sessionGoalStore'
import {
  buildRecapPrompt,
  parseSessionRecapOutput,
  SESSION_RECAP_SCHEMA,
  sessionRecapKey,
  type SessionRecap,
} from './sessionRecap'
import { readSessionRecapsEnabled, writeSessionRecap, type SessionRecapTarget } from './sessionRecapStore'
import { listViewSessionMessages, readViewSessionInfo } from './sessionReads'
import { getRunningSession, onTurnSettled, type TurnSettledEvent } from './sessionRuntime'

/** How long a session must stay quiet before it is summarized. */
export const RECAP_QUIET_MS = 60_000
const RECAP_TIMEOUT_MS = 60_000
const TRANSCRIPT_WINDOW = 120
const RECAP_DEFAULT_MODEL = 'claude-haiku-4-5'

type RecapEngineState = {
  installed: boolean
  timers: Map<string, ReturnType<typeof setTimeout>>
  generating: Set<string>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerSessionRecapEngineState: RecapEngineState | undefined
}

function engineState(): RecapEngineState {
  globalThis.__agentViewerSessionRecapEngineState ??= {
    installed: false,
    timers: new Map(),
    generating: new Set(),
  }
  return globalThis.__agentViewerSessionRecapEngineState
}

/** Register the turn-settled observer. Idempotent; call from any route that reads or toggles recaps. */
export function ensureSessionRecapEngine(): void {
  const state = engineState()
  if (state.installed) return
  state.installed = true
  onTurnSettled((event) => scheduleRecap(event))
}

function recapModel(): string {
  return process.env.AGENT_VIEWER_RECAP_MODEL?.trim() || RECAP_DEFAULT_MODEL
}

function targetOf(event: TurnSettledEvent): SessionRecapTarget {
  return {
    provider: event.provider,
    ...(event.providerInstanceId ? { providerInstanceId: event.providerInstanceId } : {}),
    sessionId: event.sessionId,
  }
}

function scheduleRecap(event: TurnSettledEvent): void {
  const state = engineState()
  const key = sessionRecapKey(event.provider, event.providerInstanceId, event.sessionId)
  const existing = state.timers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    state.timers.delete(key)
    void runRecap(event)
  }, RECAP_QUIET_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
  state.timers.set(key, timer)
}

async function runRecap(event: TurnSettledEvent): Promise<void> {
  const state = engineState()
  const key = sessionRecapKey(event.provider, event.providerInstanceId, event.sessionId)
  if (state.generating.has(key)) return
  state.generating.add(key)
  try {
    if (!(await readSessionRecapsEnabled())) return
    if (event.providerInstanceId) {
      await withProviderInstance(event.providerInstanceId, event.provider, () => generateRecap(event))
    } else {
      await generateRecap(event)
    }
  } catch (error) {
    console.error('[session-recaps] generation failed:', error)
  } finally {
    state.generating.delete(key)
  }
}

/** Generate and store now. Returns null when there is nothing to say or the session is busy. */
export async function generateRecap(event: TurnSettledEvent): Promise<SessionRecap | null> {
  const target = targetOf(event)
  // The user resumed while the timer ran: the next settle re-arms it.
  if (getRunningSession(event.sessionId, { provider: event.provider, providerInstanceId: event.providerInstanceId })) return null
  // A goal's continuation turns are the viewer talking to the agent; the goal
  // card already says where it stands.
  if (isSessionGoalLive(await readSessionGoal(target))) return null
  // A subagent's transcript is its parent's concern.
  const info = await readViewSessionInfo(event.sessionId, event.provider)
  if (info?.parentSessionId) return null

  const messages = await listViewSessionMessages(event.sessionId, {
    limit: TRANSCRIPT_WINDOW,
    offset: 0,
    tail: true,
  }, event.provider)
  const prompt = buildRecapPrompt(messages)
  if (!prompt) return null

  const result = await runStructuredQuery({
    prompt,
    schema: SESSION_RECAP_SCHEMA,
    model: recapModel(),
    signal: AbortSignal.timeout(RECAP_TIMEOUT_MS),
  })
  const recap = parseSessionRecapOutput(result.structuredOutput ?? tryParse(result.text))
  if (!recap) return null
  // Activity during the call makes this recap describe a past turn.
  if (getRunningSession(event.sessionId, { provider: event.provider, providerInstanceId: event.providerInstanceId })) return null
  await writeSessionRecap(target, recap)
  return recap
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text.trim())
  } catch {
    return null
  }
}
