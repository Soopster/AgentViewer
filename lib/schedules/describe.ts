import { describeTrigger } from './cron'
import type { Schedule, ScheduleOutcome, ScheduleRun } from './types'

/** "in 4m", "in 2h 5m", "due" — the countdown to a schedule's next run. */
export function formatCountdown(targetMs: number | undefined, now = Date.now()): string {
  if (targetMs === undefined) return '—'
  const seconds = Math.round((targetMs - now) / 1000)
  if (seconds <= 0) return 'due'
  if (seconds < 90) return `in ${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return minutes % 60 ? `in ${hours}h ${minutes % 60}m` : `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

export const OUTCOME_GLYPH: Record<ScheduleOutcome, string> = { ok: '✓', failed: '✗', skipped: '–' }

export function outcomeGlyph(run: ScheduleRun | undefined): string {
  return run ? OUTCOME_GLYPH[run.outcome] : '·'
}

/** One line a person can read: what it does and when. */
export function describeSchedule(schedule: Schedule): string {
  const { action } = schedule
  const target = action.kind === 'prompt-session' ? `session ${action.sessionId.slice(0, 8)}`
    : action.kind === 'new-session' ? `new ${action.provider} session`
    : action.kind === 'playbook' ? `playbook ${action.name}`
    : action.command
  return `${describeTrigger(schedule.trigger)} → ${target}`
}
