import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { nextTriggerFire } from './cron'
import { appendRun, readScheduleState, schedulesFile, updateScheduleState } from './store'
import type { Schedule, ScheduleOutcome } from './types'

/**
 * Fires due schedules. Shaped like `ensureMailSweep`: an unref'd interval whose ticks
 * never throw. Only one process fires (a lease file), so a daemon plus a TUI cannot
 * double-fire, and the send path loads only when something actually fires.
 */

export const SCHEDULE_TICK_MS = 15_000
export const LEASE_STALE_MS = 45_000

export interface ScheduleFireResult {
  outcome: ScheduleOutcome
  sessionId?: string
  error?: string
}

export type ScheduleRunner = (schedule: Schedule) => Promise<ScheduleFireResult>

let runnerOverride: ScheduleRunner | null = null
export function setScheduleRunner(runner: ScheduleRunner | null): void {
  runnerOverride = runner
}

const inFlight = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
let running = false

function leaseFile(): string {
  return path.join(path.dirname(schedulesFile()), 'schedules.lease.json')
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** True when this process holds (or has just taken) the lease. */
export function acquireScheduleLease(now = Date.now()): boolean {
  const file = leaseFile()
  try {
    if (existsSync(file)) {
      const held = JSON.parse(readFileSync(file, 'utf-8')) as { pid?: number; heartbeat?: number }
      const fresh = typeof held.heartbeat === 'number' && now - held.heartbeat < LEASE_STALE_MS
      if (held.pid !== process.pid && fresh && typeof held.pid === 'number' && processAlive(held.pid)) return false
    }
    mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({ pid: process.pid, heartbeat: now }), 'utf-8')
    renameSync(temporary, file)
    // Two processes may both have written; the later rename wins, so confirm.
    return (JSON.parse(readFileSync(file, 'utf-8')) as { pid?: number }).pid === process.pid
  } catch {
    return false
  }
}

async function defaultRunner(schedule: Schedule): Promise<ScheduleFireResult> {
  const { action } = schedule
  if (action.kind === 'plugin-command') {
    return { outcome: 'failed', error: `Plugin command "${action.command}" cannot run unattended yet` }
  }
  if (action.kind === 'playbook') {
    const { startProtocolRun } = await import('../agentCoordination')
    const run = await startProtocolRun({
      prompt: schedule.prompt || action.name,
      baseCwd: action.cwd,
      playbookName: action.name,
      playbookArgs: action.args,
      provider: action.provider as never,
      title: schedule.name,
    })
    return { outcome: 'ok', sessionId: (run as { leadSessionId?: string }).leadSessionId }
  }
  const backend = await import('../sessionBackend')
  const coordination = await import('../agentCoordination')
  let sessionId: string
  let provider: string
  if (action.kind === 'new-session') {
    const created = await backend.createNewViewSession({ provider: action.provider as never, cwd: action.cwd })
    sessionId = created.sessionId
    provider = created.provider
  } else {
    sessionId = action.sessionId
    provider = action.provider
  }
  const body: Record<string, unknown> = { message: schedule.prompt }
  if (action.kind === 'new-session' && action.model) body.model = action.model
  const response = await coordination.withCooperativeInbox(sessionId, body, outgoing =>
    backend.streamViewSessionTurn({
      sessionId,
      signal: new AbortController().signal,
      body: outgoing,
      provider: provider as never,
    }))
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { outcome: 'failed', sessionId, error: `HTTP ${response.status} ${detail}`.slice(0, 300) }
  }
  // Drain server-side so the turn runs to its end with no client attached.
  await response.body?.pipeTo(new WritableStream({ write() {} })).catch(() => {})
  return { outcome: 'ok', sessionId }
}

async function sessionIsRunning(schedule: Schedule): Promise<boolean> {
  if (schedule.action.kind !== 'prompt-session') return false
  const { sessionId } = schedule.action
  const { listViewRunningSessions } = await import('../sessionActivity')
  return listViewRunningSessions().some(running => running.sessionId === sessionId)
}

async function notifyFailure(schedule: Schedule, sessionId: string | undefined, error: string): Promise<void> {
  try {
    const sessionTarget = sessionId ?? (schedule.action.kind === 'prompt-session' ? schedule.action.sessionId : undefined)
    if (!sessionTarget) return
    const { postViewerAttention } = await import('../viewerAttention')
    postViewerAttention({ sessionId: sessionTarget, title: `Schedule "${schedule.name}" failed`, detail: error })
  } catch {
    // a failed notification must not fail the engine
  }
}

async function fire(schedule: Schedule, now: () => number): Promise<void> {
  const startedAt = now()
  let result: ScheduleFireResult
  try {
    result = await (runnerOverride ?? defaultRunner)(schedule)
  } catch (error) {
    result = { outcome: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
  appendRun({
    scheduleId: schedule.id,
    startedAt,
    endedAt: now(),
    outcome: result.outcome,
    ...(result.sessionId ? { sessionId: result.sessionId } : {}),
    ...(result.error ? { error: result.error } : {}),
  })
  if (result.outcome === 'failed') await notifyFailure(schedule, result.sessionId, result.error ?? 'unknown error')
}

/** One pass: advance what is due, fire what should fire. Returns the ids fired or skipped. */
export async function runScheduleTick(nowMs: number = Date.now(), clock: () => number = Date.now): Promise<string[]> {
  if (process.env.AGENT_VIEWER_SCHEDULES === '0') return []
  if (!acquireScheduleLease(nowMs)) return []
  const due: Schedule[] = []
  const skipped: Schedule[] = []
  const handled: string[] = []
  updateScheduleState(state => {
    for (const schedule of state.schedules) {
      if (schedule.expiresAt !== undefined && schedule.expiresAt <= nowMs) schedule.enabled = false
      if (!schedule.enabled) continue
      if (schedule.nextRunAt === undefined) {
        schedule.nextRunAt = nextTriggerFire(schedule.trigger, nowMs) ?? undefined
        continue
      }
      if (schedule.nextRunAt > nowMs) continue
      const missedBy = nowMs - schedule.nextRunAt
      const advanced = nextTriggerFire(schedule.trigger, nowMs) ?? undefined
      if (missedBy > SCHEDULE_TICK_MS * 2 && schedule.catchUp === 'skip') {
        schedule.nextRunAt = advanced
        skipped.push(schedule)
        continue
      }
      if (inFlight.has(schedule.id)) {
        schedule.nextRunAt = advanced
        skipped.push(schedule)
        continue
      }
      // Advance before firing: a crash mid-turn must not replay it on restart.
      schedule.nextRunAt = advanced
      // A one-off has nothing after its fire.
      if (advanced === undefined) schedule.enabled = false
      due.push({ ...schedule })
    }
  })
  const startedAt = nowMs
  for (const schedule of skipped) {
    appendRun({ scheduleId: schedule.id, startedAt, endedAt: startedAt, outcome: 'skipped' })
    handled.push(schedule.id)
  }
  for (const schedule of due) {
    handled.push(schedule.id)
    if (await sessionIsRunning(schedule).catch(() => false)) {
      if (schedule.overlap === 'queue') {
        // Retry on the next tick, once the session is idle.
        updateScheduleState(state => {
          const stored = state.schedules.find(candidate => candidate.id === schedule.id)
          if (stored) stored.nextRunAt = nowMs + SCHEDULE_TICK_MS
        })
      } else {
        appendRun({ scheduleId: schedule.id, startedAt, endedAt: startedAt, outcome: 'skipped', error: 'session already running' })
      }
      continue
    }
    inFlight.add(schedule.id)
    void fire(schedule, clock).finally(() => inFlight.delete(schedule.id))
  }
  return handled
}

/** Fire one schedule now regardless of its trigger (does not move nextRunAt). */
export async function runScheduleNow(id: string): Promise<void> {
  const schedule = readScheduleState().schedules.find(candidate => candidate.id === id)
  if (!schedule) throw new Error(`No schedule "${id}"`)
  if (inFlight.has(id)) throw new Error('Schedule is already running')
  inFlight.add(id)
  try {
    await fire(schedule, Date.now)
  } finally {
    inFlight.delete(id)
  }
}

/** Sleep until the nearest due schedule, but never past a tick (the lease heartbeat and newly added schedules) or under a second. */
export function nextWakeDelay(nowMs: number = Date.now()): number {
  let soonest = Infinity
  for (const schedule of readScheduleState().schedules) {
    if (schedule.enabled && schedule.nextRunAt !== undefined) soonest = Math.min(soonest, schedule.nextRunAt)
  }
  return Math.min(Math.max(soonest - nowMs, 1000), SCHEDULE_TICK_MS)
}

export function ensureScheduleEngine(): void {
  if (running || process.env.AGENT_VIEWER_SCHEDULES === '0') return
  running = true
  const loop = () => {
    void runScheduleTick().catch(() => {}).finally(() => {
      if (!running) return
      timer = setTimeout(loop, nextWakeDelay())
      timer.unref?.()
    })
  }
  loop()
}

export function stopScheduleEngine(): void {
  running = false
  if (timer) clearTimeout(timer)
  timer = null
}
