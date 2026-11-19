/** Schedules: a trigger decides when, an action decides what, settings decide how. */

export type EveryUnit = 's' | 'm' | 'h' | 'd' | 'w'

export type ScheduleTrigger =
  | { kind: 'cron'; expression: string; timeZone?: string }
  | { kind: 'every'; amount: number; unit: EveryUnit }
  /** Once, at an absolute time; the schedule turns itself off afterwards. */
  | { kind: 'at'; at: number }

export type ScheduleAction =
  | { kind: 'prompt-session'; sessionId: string; provider: string; instance?: string }
  | { kind: 'new-session'; provider: string; cwd: string; model?: string }
  | { kind: 'playbook'; name: string; cwd: string; provider: string; args?: Record<string, string> }
  | { kind: 'plugin-command'; command: string }

export interface Schedule {
  id: string
  name: string
  trigger: ScheduleTrigger
  action: ScheduleAction
  prompt: string
  overlap: 'skip' | 'queue'
  catchUp: 'once' | 'skip'
  enabled: boolean
  expiresAt?: number
  createdAt: number
  /** Epoch ms of the next planned fire; advanced by the engine, never by callers. */
  nextRunAt?: number
  /** Declared by a plugin manifest rather than by the user. */
  source?: string
}

export type ScheduleOutcome = 'ok' | 'skipped' | 'failed'

export interface ScheduleRun {
  scheduleId: string
  startedAt: number
  endedAt: number
  sessionId?: string
  outcome: ScheduleOutcome
  error?: string
}

export interface ScheduleState {
  schedules: Schedule[]
  runs: ScheduleRun[]
}

export const SCHEDULE_RUN_HISTORY_MAX = 200
/** Shortest repeat. The engine wakes for the nearest due schedule, so seconds are real. */
export const SCHEDULE_MIN_INTERVAL_MS = 10_000

export const EVERY_UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const
