import { unitOf } from './duration'
import { EVERY_UNIT_MS, type ScheduleTrigger } from './types'

/**
 * Five-field cron (minute hour day-of-month month day-of-week) with a time zone.
 * Own parser: a dependency would fall under the release-age policy for ~150 lines.
 *
 * Fields are evaluated against wall-clock time in the zone, so a DST gap skips a
 * nonexistent local time and an overlap fires once (the first occurrence).
 */

export interface CronFields {
  minutes: Set<number>
  hours: Set<number>
  days: Set<number>
  months: Set<number>
  weekdays: Set<number>
  dayRestricted: boolean
  weekdayRestricted: boolean
}

const RANGES: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]

function parseField(text: string, [min, max]: [number, number], names?: string[]): Set<number> {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const [rangeText, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${part}"`)
    const toNumber = (token: string): number => {
      const named = names?.indexOf(token.toLowerCase())
      const value = named !== undefined && named >= 0 ? named + (min === 1 ? 1 : 0) : Number(token)
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`"${token}" is outside ${min}-${max}`)
      return value
    }
    let from: number
    let to: number
    if (rangeText === '*') {
      from = min
      to = max
    } else if (rangeText.includes('-')) {
      const [a, b] = rangeText.split('-')
      from = toNumber(a)
      to = toNumber(b)
      if (from > to) throw new Error(`Range "${rangeText}" runs backwards`)
    } else {
      from = toNumber(rangeText)
      to = stepText === undefined ? from : max
    }
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return values
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('A cron expression has five fields: minute hour day month weekday')
  const [minutes, hours, days, months, weekdays] = parts.map((part, index) =>
    parseField(part, RANGES[index], index === 3 ? MONTH_NAMES : index === 4 ? DAY_NAMES : undefined))
  // 7 is Sunday as well as 0.
  if (weekdays.has(7)) {
    weekdays.delete(7)
    weekdays.add(0)
  }
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    dayRestricted: parts[2] !== '*',
    weekdayRestricted: parts[4] !== '*',
  }
}

interface Wall {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

function wallTime(epochMs: number, timeZone: string): Wall {
  const parts: Record<string, string> = {}
  for (const part of formatterFor(timeZone).formatToParts(epochMs)) parts[part.type] = part.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: DAY_NAMES.indexOf(parts.weekday.toLowerCase()),
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

function dayMatches(fields: CronFields, wall: Wall): boolean {
  const dayOk = fields.days.has(wall.day)
  const weekdayOk = fields.weekdays.has(wall.weekday)
  // Standard cron: when both are restricted either may match.
  if (fields.dayRestricted && fields.weekdayRestricted) return dayOk || weekdayOk
  return dayOk && weekdayOk
}

/** First fire strictly after `after`, or null if none within four years. */
export function nextCronFire(expression: string, after: number, timeZone = 'UTC'): number | null {
  const fields = parseCron(expression)
  const limit = after + 4 * 366 * 86_400_000
  // Walk minute by minute but skip whole non-matching hours/days using the wall clock.
  let cursor = Math.floor(after / 60_000) * 60_000 + 60_000
  while (cursor <= limit) {
    const wall = wallTime(cursor, timeZone)
    if (!fields.months.has(wall.month) || !dayMatches(fields, wall)) {
      // Jump to the next local midnight (≈ 24h minus time already elapsed today).
      cursor += ((23 - wall.hour) * 60 + (60 - wall.minute)) * 60_000
      continue
    }
    if (!fields.hours.has(wall.hour)) {
      cursor += (60 - wall.minute) * 60_000
      continue
    }
    if (fields.minutes.has(wall.minute)) {
      // A fall-back repeats a wall-clock hour; the first occurrence is the fire.
      const earlier = wallTime(cursor - 3_600_000, timeZone)
      const repeated = earlier.day === wall.day && earlier.hour === wall.hour && earlier.minute === wall.minute
      if (!repeated) return cursor
    }
    cursor += 60_000
  }
  return null
}

export function nextTriggerFire(trigger: ScheduleTrigger, after: number): number | null {
  if (trigger.kind === 'every') return after + trigger.amount * EVERY_UNIT_MS[trigger.unit]
  if (trigger.kind === 'at') return trigger.at > after ? trigger.at : null
  return nextCronFire(trigger.expression, after, trigger.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
}

/** Parses "every 1h" / "every 30m"; null when the text is not that form. */
export function parseEvery(text: string): ScheduleTrigger | null {
  const match = /^every\s+(?:(\d+)\s*)?([a-z]+)$/i.exec(text.trim())
  if (!match) return null
  const unit = unitOf(match[2])
  const amount = match[1] === undefined ? 1 : Number(match[1])
  if (!unit || amount < 1) return null
  return { kind: 'every', amount, unit }
}

export function validateTrigger(trigger: ScheduleTrigger): string | null {
  if (trigger.kind === 'every') {
    if (!Number.isInteger(trigger.amount) || trigger.amount < 1) return 'Interval must be a positive whole number'
    return null
  }
  if (trigger.kind === 'at') return Number.isFinite(trigger.at) ? null : 'A one-off schedule needs a time'
  try {
    parseCron(trigger.expression)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  if (trigger.timeZone && !isValidTimeZone(trigger.timeZone)) return `Unknown time zone "${trigger.timeZone}"`
  return null
}

export function describeTrigger(trigger: ScheduleTrigger): string {
  if (trigger.kind === 'every') {
    const unit = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week' }[trigger.unit]
    return trigger.amount === 1 ? `every ${unit}` : `every ${trigger.amount} ${unit}s`
  }
  if (trigger.kind === 'at') return `once at ${new Date(trigger.at).toLocaleString()}`
  return `cron ${trigger.expression}${trigger.timeZone ? ` (${trigger.timeZone})` : ''}`
}
