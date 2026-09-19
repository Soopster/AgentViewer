export type PiActivityStage = 'loading-sdk' | 'resolving-packages' | 'creating-session'
export type PiActivityTone = 'info' | 'success' | 'error'

export type PiActivityEvent = {
  id: number
  timestamp: number
  tone: PiActivityTone
  message: string
}

export type PiActivitySnapshot = {
  revision: number
  active: boolean
  stage: PiActivityStage | 'ready' | 'error' | 'idle'
  headline: string
  sessionId?: string
  updatedAt: number
  events: PiActivityEvent[]
}

type PiActivityOperation = {
  token: string
  sessionId?: string
  stage: PiActivityStage
  headline: string
}

type PiActivityState = {
  snapshot: PiActivitySnapshot
  operations: Map<string, PiActivityOperation>
  listeners: Set<() => void>
  nextEventId: number
  nextOperationId: number
}

declare global {
  // Keep status subscribers connected across Next.js development reloads.
  // eslint-disable-next-line no-var
  var __agentViewerPiActivityState: PiActivityState | undefined
}

const MAX_EVENTS = 40

function createState(): PiActivityState {
  return {
    snapshot: {
      revision: 0,
      active: false,
      stage: 'idle',
      headline: 'Pi is idle',
      updatedAt: Date.now(),
      events: [],
    },
    operations: new Map(),
    listeners: new Set(),
    nextEventId: 1,
    nextOperationId: 1,
  }
}

const state = globalThis.__agentViewerPiActivityState
  ?? (globalThis.__agentViewerPiActivityState = createState())

function publish(patch: Partial<Omit<PiActivitySnapshot, 'revision' | 'updatedAt'>>, event?: Omit<PiActivityEvent, 'id' | 'timestamp'>): void {
  const events = event
    ? [...state.snapshot.events, { ...event, id: state.nextEventId++, timestamp: Date.now() }].slice(-MAX_EVENTS)
    : state.snapshot.events
  state.snapshot = {
    ...state.snapshot,
    ...patch,
    revision: state.snapshot.revision + 1,
    updatedAt: Date.now(),
    events,
  }
  for (const listener of state.listeners) listener()
}

function newestOperation(): PiActivityOperation | undefined {
  return Array.from(state.operations.values()).at(-1)
}

export function beginPiActivity(sessionId: string | undefined, headline: string): string {
  const token = `pi-${Date.now()}-${state.nextOperationId++}`
  state.operations.set(token, { token, sessionId, stage: 'loading-sdk', headline })
  publish(
    { active: true, stage: 'loading-sdk', headline, sessionId },
    { tone: 'info', message: headline },
  )
  return token
}

export function updatePiActivity(token: string, stage: PiActivityStage, headline: string): void {
  const operation = state.operations.get(token)
  if (!operation) return
  operation.stage = stage
  operation.headline = headline
  publish(
    { active: true, stage, headline, sessionId: operation.sessionId },
    { tone: 'info', message: headline },
  )
}

export function appendPiActivity(token: string, message: string, tone: PiActivityTone = 'info'): void {
  const operation = state.operations.get(token)
  if (!operation) return
  publish({
    active: true,
    stage: operation.stage,
    headline: operation.headline,
    sessionId: operation.sessionId,
  }, { tone, message })
}

export function completePiActivity(token: string): void {
  const operation = state.operations.get(token)
  if (!operation) return
  state.operations.delete(token)
  const remaining = newestOperation()
  if (remaining) {
    publish({
      active: true,
      stage: remaining.stage,
      headline: remaining.headline,
      sessionId: remaining.sessionId,
    })
    return
  }
  publish(
    { active: false, stage: 'ready', headline: 'Pi is ready', sessionId: operation.sessionId },
    { tone: 'success', message: 'Pi session is ready' },
  )
}

export function failPiActivity(token: string, error: unknown): void {
  const operation = state.operations.get(token)
  state.operations.delete(token)
  const message = error instanceof Error ? error.message : String(error)
  const remaining = newestOperation()
  publish(
    remaining
      ? {
          active: true,
          stage: remaining.stage,
          headline: remaining.headline,
          sessionId: remaining.sessionId,
        }
      : {
          active: false,
          stage: 'error',
          headline: 'Pi failed to initialize',
          sessionId: operation?.sessionId,
        },
    { tone: 'error', message },
  )
}

export function getPiActivitySnapshot(): PiActivitySnapshot {
  return state.snapshot
}

export function subscribeToPiActivity(listener: () => void): () => void {
  state.listeners.add(listener)
  return () => state.listeners.delete(listener)
}
