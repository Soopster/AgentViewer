import { EVERY_UNIT_MS, type EveryUnit } from './types'

const WORDS: Record<string, EveryUnit> = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's',
  m: 'm', min: 'm', mins: 'm', minute: 'm', minutes: 'm',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  d: 'd', day: 'd', days: 'd',
  w: 'w', wk: 'w', wks: 'w', week: 'w', weeks: 'w',
}

/** Matches "10 seconds", "1h", "2 hrs" (the unit word, singular or plural). */
export const DURATION_SOURCE = '(\\d+)\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|[smhdw])\\b'

export function unitOf(word: string): EveryUnit | null {
  return WORDS[word.toLowerCase()] ?? null
}

/** "10 seconds" → { amount: 10, unit: 's', ms: 10000 }, or null. */
export function parseDuration(text: string): { amount: number; unit: EveryUnit; ms: number } | null {
  const match = new RegExp(`^${DURATION_SOURCE}$`, 'i').exec(text.trim())
  if (!match) return null
  const unit = unitOf(match[2])
  const amount = Number(match[1])
  return unit && amount > 0 ? { amount, unit, ms: amount * EVERY_UNIT_MS[unit] } : null
}
