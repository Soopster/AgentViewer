import { parseCron } from './cron'
import { DURATION_SOURCE, parseDuration, unitOf } from './duration'
import type { ScheduleTrigger } from './types'

export const SCHEDULE_SLASH_USAGE = '/schedule every 10 minutes <prompt> [for 2 hours] · every weekday at 9am <prompt> · in 30 minutes <prompt> · "0 9 * * 1-5" <prompt>'

export type ScheduleSlashParse =
  | { trigger: ScheduleTrigger; prompt: string; /** Stop repeating after this long. */ expiresInMs?: number }
  | { error: string }

const TIME_SOURCE = '(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)'
const DAY_CRON: Record<string, string> = {
  day: '*', daily: '*', everyday: '*', weekday: '1-5', weekdays: '1-5', weekend: '0,6', weekends: '0,6',
  sun: '0', sunday: '0', mon: '1', monday: '1', tue: '2', tues: '2', tuesday: '2', wed: '3', weds: '3', wednesday: '3',
  thu: '4', thur: '4', thurs: '4', thursday: '4', fri: '5', friday: '5', sat: '6', saturday: '6',
}

/** "9am" → [9,0]; "17:30" → [17,30]; "noon" → [12,0]; null when it is not a time of day. */
export function parseTimeOfDay(text: string): [number, number] | null {
  const word = text.trim().toLowerCase()
  if (word === 'noon') return [12, 0]
  if (word === 'midnight') return [0, 0]
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(word)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  if (match[3]) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (match[3] === 'pm' ? 12 : 0)
  }
  return hour <= 23 && minute <= 59 ? [hour, minute] : null
}

/** The next local occurrence of a time of day, today if it is still ahead. */
function nextLocalTime([hour, minute]: [number, number], now: number): number {
  const date = new Date(now)
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() <= now) date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** Peels a leading or trailing "for <duration>" (how long to keep repeating) off the prompt. */
function takeLimit(rest: string): { prompt: string; expiresInMs?: number } | { error: string } {
  let prompt = rest.trim()
  let expiresInMs: number | undefined
  const leading = new RegExp(`^for\\s+${DURATION_SOURCE}\\s*`, 'i').exec(prompt)
  if (leading) {
    expiresInMs = parseDuration(`${leading[1]} ${leading[2]}`)?.ms
    prompt = prompt.slice(leading[0].length).trim()
  } else {
    const trailing = new RegExp(`\\s+for\\s+${DURATION_SOURCE}\\s*$`, 'i').exec(prompt)
    if (trailing) {
      expiresInMs = parseDuration(`${trailing[1]} ${trailing[2]}`)?.ms
      prompt = prompt.slice(0, trailing.index).trim()
    }
  }
  if (!prompt) return { error: `What should it say? ${SCHEDULE_SLASH_USAGE}` }
  return { prompt, ...(expiresInMs ? { expiresInMs } : {}) }
}

function finish(trigger: ScheduleTrigger, rest: string): ScheduleSlashParse {
  const limit = takeLimit(rest)
  return 'error' in limit ? limit : { trigger, ...limit }
}

/**
 * Reads what follows `/schedule`:
 *   every [N] second|minute|hour|day|week …   every 10 seconds, every hour, every 2h
 *   every day|weekday|weekend|monday… at TIME every weekday at 9am (local time)
 *   in DURATION …                             once, in 30 minutes
 *   at TIME …                                 once, at the next 3pm
 *   "CRON" …  or five bare cron fields …      0 9 * * 1-5 (quote it to be sure)
 * and, before or after the prompt, `for DURATION` to stop repeating after that long.
 */
export function parseScheduleSlash(args: string, now = Date.now()): ScheduleSlashParse {
  const text = args.trim()
  if (!text) return { error: `Usage: ${SCHEDULE_SLASH_USAGE}` }

  const quoted = /^(["'])(.+?)\1\s*([\s\S]*)$/.exec(text)
  if (quoted) {
    try { parseCron(quoted[2]) } catch (error) { return { error: `Bad cron "${quoted[2]}": ${error instanceof Error ? error.message : error}` } }
    return finish({ kind: 'cron', expression: quoted[2].trim() }, quoted[3])
  }

  const daily = new RegExp(`^(?:every\\s+)?([a-z]+)\\s+at\\s+${TIME_SOURCE}\\b\\s*([\\s\\S]*)$`, 'i').exec(text)
  if (daily && DAY_CRON[daily[1].toLowerCase()] !== undefined) {
    const time = parseTimeOfDay(daily[2])
    if (!time) return { error: `"${daily[2]}" is not a time of day` }
    return finish({ kind: 'cron', expression: `${time[1]} ${time[0]} * * ${DAY_CRON[daily[1].toLowerCase()]}` }, daily[3])
  }

  const every = /^every\s+(?:(\d+)\s*)?([a-z]+)\b\s*([\s\S]*)$/i.exec(text)
  if (every) {
    const unit = unitOf(every[2])
    if (unit) return finish({ kind: 'every', amount: every[1] === undefined ? 1 : Number(every[1]), unit }, every[3])
  }

  const within = new RegExp(`^in\\s+${DURATION_SOURCE}\\s*([\\s\\S]*)$`, 'i').exec(text)
  if (within) {
    const duration = parseDuration(`${within[1]} ${within[2]}`)
    if (duration) {
      const limit = takeLimit(within[3])
      return 'error' in limit ? limit : { trigger: { kind: 'at', at: now + duration.ms }, prompt: limit.prompt }
    }
  }

  const at = new RegExp(`^at\\s+${TIME_SOURCE}\\b\\s*([\\s\\S]*)$`, 'i').exec(text)
  if (at) {
    const time = parseTimeOfDay(at[1])
    if (!time) return { error: `"${at[1]}" is not a time of day` }
    const limit = takeLimit(at[2])
    return 'error' in limit ? limit : { trigger: { kind: 'at', at: nextLocalTime(time, now) }, prompt: limit.prompt }
  }

  // Five bare cron fields, only when they really parse as cron.
  const tokens = text.split(/\s+/)
  if (tokens.length > 5 && tokens.slice(0, 5).every(token => /^[\d*/,\-a-z]+$/i.test(token) && /[\d*]/.test(token))) {
    const expression = tokens.slice(0, 5).join(' ')
    try {
      parseCron(expression)
      return finish({ kind: 'cron', expression }, tokens.slice(5).join(' '))
    } catch {
      // not cron after all; fall through to the usage message
    }
  }

  return { error: `Could not read a schedule from that. Try: ${SCHEDULE_SLASH_USAGE}` }
}
