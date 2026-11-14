// Session Goals — local persistence.
//
// One flat JSON file under .agent-viewer-data/, keyed by provider + instance +
// session so the same native session id can hold independent goals under two
// configured accounts. Nothing here is provider-specific: a goal is a note the
// viewer keeps for itself and acts on through sessionBackend.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_MAX_CONTINUATIONS,
  parseSessionGoalKey,
  sanitizeSessionGoal,
  sessionGoalKey,
  type SessionGoal,
} from './sessionGoals'
import type { AgentProvider } from './types'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const GOALS_FILE = path.join(DATA_DIR, 'session-goals.json')

export type SessionGoalTarget = {
  provider: AgentProvider
  providerInstanceId?: string
  sessionId: string
}

type GoalStore = Record<string, SessionGoal>

let storeCache: GoalStore | null = null
let writeChain: Promise<unknown> = Promise.resolve()

async function loadStore(): Promise<GoalStore> {
  if (storeCache !== null) return storeCache
  try {
    const contents = await readFile(GOALS_FILE, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    if (!parsed || typeof parsed !== 'object') {
      storeCache = {}
      return storeCache
    }
    const store: GoalStore = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const parsedKey = parseSessionGoalKey(key)
      const goal = sanitizeSessionGoal(value, parsedKey?.provider, parsedKey?.sessionId)
      if (goal) store[key] = goal
    }
    storeCache = store
    return storeCache
  } catch {
    storeCache = {}
    return storeCache
  }
}

async function saveStore(store: GoalStore): Promise<void> {
  storeCache = store
  const body = JSON.stringify(store, null, 2)
  const write = async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const temp = `${GOALS_FILE}.${process.pid}.tmp`
    await writeFile(temp, body, 'utf8')
    await rename(temp, GOALS_FILE)
  }
  const next = writeChain.then(write, write)
  writeChain = next.catch(() => undefined)
  try {
    await next
  } catch (err) {
    console.error('[session-goals] Failed to save:', err)
  }
}

export async function readSessionGoal(target: SessionGoalTarget): Promise<SessionGoal | null> {
  const store = await loadStore()
  return store[sessionGoalKey(target.provider, target.providerInstanceId, target.sessionId)] ?? null
}

export async function listSessionGoals(): Promise<SessionGoal[]> {
  const store = await loadStore()
  return Object.values(store)
}

export async function upsertSessionGoal(goal: SessionGoal): Promise<SessionGoal> {
  const store = await loadStore()
  const key = sessionGoalKey(goal.provider, goal.providerInstanceId, goal.sessionId)
  store[key] = goal
  await saveStore(store)
  return goal
}

export async function createSessionGoal(input: {
  target: SessionGoalTarget
  objective: string
  tokenBudget?: number | null
  maxContinuations?: number
}): Promise<SessionGoal> {
  const now = new Date().toISOString()
  const goal: SessionGoal = {
    provider: input.target.provider,
    ...(input.target.providerInstanceId ? { providerInstanceId: input.target.providerInstanceId } : {}),
    sessionId: input.target.sessionId,
    objective: input.objective,
    status: 'active',
    tokenBudget: input.tokenBudget ?? null,
    tokensUsed: 0,
    continuations: 0,
    maxContinuations: input.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS,
    createdAt: now,
    updatedAt: now,
    lastNote: null,
    lastDecision: null,
    lastEvaluatedAt: null,
    error: null,
  }
  return upsertSessionGoal(goal)
}

export type SessionGoalPatch = Partial<Pick<
  SessionGoal,
  'objective' | 'status' | 'tokenBudget' | 'tokensUsed' | 'continuations' | 'maxContinuations' |
  'lastNote' | 'lastDecision' | 'lastEvaluatedAt' | 'error'
>>

export async function patchSessionGoal(target: SessionGoalTarget, patch: SessionGoalPatch): Promise<SessionGoal | null> {
  const store = await loadStore()
  const key = sessionGoalKey(target.provider, target.providerInstanceId, target.sessionId)
  const existing = store[key]
  if (!existing) return null
  const next = sanitizeSessionGoal({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
  if (!next) return null
  store[key] = next
  await saveStore(store)
  return next
}

export async function removeSessionGoal(target: SessionGoalTarget): Promise<boolean> {
  const store = await loadStore()
  const key = sessionGoalKey(target.provider, target.providerInstanceId, target.sessionId)
  if (!(key in store)) return false
  delete store[key]
  await saveStore(store)
  return true
}

/** Every goal for one native session id, across accounts. */
export async function listSessionGoalsForSessionId(sessionId: string): Promise<SessionGoal[]> {
  const goals = await listSessionGoals()
  return goals.filter((goal) => goal.sessionId === sessionId)
}
