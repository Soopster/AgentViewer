import { randomUUID } from 'node:crypto'
import { nextTriggerFire, validateTrigger } from './cron'
import { readScheduleState, runsFor, updateScheduleState } from './store'
import {
  SCHEDULE_MIN_INTERVAL_MS,
  EVERY_UNIT_MS,
  type Schedule,
  type ScheduleAction,
  type ScheduleRun,
  type ScheduleTrigger,
} from './types'

export interface ScheduleInput {
  name: string
  trigger: ScheduleTrigger
  action: ScheduleAction
  prompt?: string
  overlap?: 'skip' | 'queue'
  catchUp?: 'once' | 'skip'
  enabled?: boolean
  expiresAt?: number
  source?: string
}

export interface ScheduleListing extends Schedule {
  recentRuns: ScheduleRun[]
}

function validate(input: ScheduleInput): void {
  if (!input.name?.trim()) throw new Error('name is required')
  const triggerError = validateTrigger(input.trigger)
  if (triggerError) throw new Error(triggerError)
  if (input.trigger.kind === 'every' && input.trigger.amount * EVERY_UNIT_MS[input.trigger.unit] < SCHEDULE_MIN_INTERVAL_MS) {
    throw new Error(`Interval must be at least ${SCHEDULE_MIN_INTERVAL_MS / 1000} seconds`)
  }
  if (input.trigger.kind === 'at' && input.trigger.at <= Date.now()) throw new Error('That time has already passed')
  const { action } = input
  if (action.kind === 'prompt-session' && (!action.sessionId || !action.provider)) throw new Error('prompt-session needs sessionId and provider')
  if (action.kind === 'new-session' && (!action.provider || !action.cwd)) throw new Error('new-session needs provider and cwd')
  if (action.kind === 'playbook' && (!action.name || !action.cwd || !action.provider)) throw new Error('playbook needs name, cwd and provider')
  if (action.kind === 'plugin-command' && !action.command) throw new Error('plugin-command needs command')
  if ((action.kind === 'prompt-session' || action.kind === 'new-session') && !input.prompt?.trim()) throw new Error('prompt is required')
}

export function listSchedulesWithRuns(): ScheduleListing[] {
  return readScheduleState().schedules.map(schedule => ({ ...schedule, recentRuns: runsFor(schedule.id, 5) }))
}

export function createSchedule(input: ScheduleInput, now = Date.now()): Schedule {
  validate(input)
  const schedule: Schedule = {
    id: randomUUID(),
    name: input.name.trim(),
    trigger: input.trigger,
    action: input.action,
    prompt: input.prompt?.trim() ?? '',
    overlap: input.overlap ?? 'skip',
    catchUp: input.catchUp ?? 'once',
    enabled: input.enabled ?? true,
    createdAt: now,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.source ? { source: input.source } : {}),
    nextRunAt: nextTriggerFire(input.trigger, now) ?? undefined,
  }
  updateScheduleState(state => {
    state.schedules.push(schedule)
  })
  return schedule
}

function mutate(id: string, change: (schedule: Schedule) => void): Schedule {
  let found: Schedule | undefined
  updateScheduleState(state => {
    found = state.schedules.find(schedule => schedule.id === id)
    if (found) change(found)
  })
  if (!found) throw new Error(`No schedule "${id}"`)
  return found
}

export function updateSchedule(id: string, patch: Partial<ScheduleInput>, now = Date.now()): Schedule {
  const current = readScheduleState().schedules.find(schedule => schedule.id === id)
  if (!current) throw new Error(`No schedule "${id}"`)
  const merged = { ...current, ...patch } as ScheduleInput
  validate(merged)
  return mutate(id, schedule => {
    Object.assign(schedule, {
      name: merged.name.trim(),
      trigger: merged.trigger,
      action: merged.action,
      prompt: merged.prompt?.trim() ?? '',
      overlap: merged.overlap ?? schedule.overlap,
      catchUp: merged.catchUp ?? schedule.catchUp,
      enabled: merged.enabled ?? schedule.enabled,
      expiresAt: merged.expiresAt,
    })
    // A changed trigger must not wait on the old one's next fire.
    schedule.nextRunAt = nextTriggerFire(schedule.trigger, now) ?? undefined
  })
}

export function setScheduleEnabled(id: string, enabled: boolean, now = Date.now()): Schedule {
  return mutate(id, schedule => {
    schedule.enabled = enabled
    // Resuming plans from now: a long pause must not fire a catch-up burst.
    if (enabled) schedule.nextRunAt = nextTriggerFire(schedule.trigger, now) ?? undefined
  })
}

export function deleteSchedule(id: string): void {
  let existed = false
  updateScheduleState(state => {
    const before = state.schedules.length
    state.schedules = state.schedules.filter(schedule => schedule.id !== id)
    state.runs = state.runs.filter(run => run.scheduleId !== id)
    existed = state.schedules.length !== before
  })
  if (!existed) throw new Error(`No schedule "${id}"`)
}
