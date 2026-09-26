type HashState = {
  a: number
  b: number
  chars: number
}

const HASH_A_INIT = 0x811c9dc5
const HASH_B_INIT = 0x9e3779b9
const HASH_A_PRIME = 0x01000193

function mixCode(state: HashState, code: number): void {
  state.a = Math.imul(state.a ^ code, HASH_A_PRIME) >>> 0
  state.b = (Math.imul(state.b ^ code, 33) + 0x7ed55d16) >>> 0
}

function mixSmallNumber(state: HashState, value: number): void {
  mixCode(state, value & 0xff)
  mixCode(state, (value >>> 8) & 0xff)
  mixCode(state, (value >>> 16) & 0xff)
  mixCode(state, (value >>> 24) & 0xff)
}

function mixString(state: HashState, value: string): void {
  state.chars += value.length
  mixSmallNumber(state, value.length)
  for (let i = 0; i < value.length; i += 1) {
    mixCode(state, value.charCodeAt(i))
  }
}

function hashValue(state: HashState, value: unknown, seen: WeakSet<object>): void {
  if (value === null) {
    mixString(state, 'null')
    return
  }

  switch (typeof value) {
    case 'string':
      mixString(state, 'string')
      mixString(state, value)
      return
    case 'number':
      mixString(state, 'number')
      mixString(state, Object.is(value, -0) ? '-0' : String(value))
      return
    case 'boolean':
      mixString(state, value ? 'true' : 'false')
      return
    case 'undefined':
      mixString(state, 'undefined')
      return
    case 'bigint':
      mixString(state, 'bigint')
      mixString(state, value.toString())
      return
    case 'symbol':
      mixString(state, 'symbol')
      mixString(state, value.description ?? '')
      return
    case 'function':
      mixString(state, 'function')
      mixString(state, value.name)
      return
    case 'object':
      break
  }

  if (seen.has(value)) {
    mixString(state, 'circular')
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    mixString(state, 'array')
    mixSmallNumber(state, value.length)
    for (const item of value) hashValue(state, item, seen)
    seen.delete(value)
    return
  }

  if (value instanceof Date) {
    mixString(state, 'date')
    mixString(state, value.toISOString())
    seen.delete(value)
    return
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  mixString(state, 'object')
  mixSmallNumber(state, keys.length)
  for (const key of keys) {
    mixString(state, key)
    hashValue(state, record[key], seen)
  }
  seen.delete(value)
}

export function compactStableFingerprint(value: unknown): string {
  const state: HashState = {
    a: HASH_A_INIT,
    b: HASH_B_INIT,
    chars: 0,
  }
  hashValue(state, value, new WeakSet<object>())
  return `${state.chars.toString(36)}:${state.a.toString(36)}:${state.b.toString(36)}`
}
