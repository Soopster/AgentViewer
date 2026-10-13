const HASH_A_INIT = 0x811c9dc5
const HASH_B_INIT = 0x9e3779b9
const HASH_A_PRIME = 0x01000193
const HASH_B_OFFSET = 0x7ed55d16

// The two hash lanes and the character count live in module scope as int32s,
// and each string is mixed through locals. The previous shape kept them as
// uint32 fields on a state object (`>>> 0` after every step): a value above
// 2^31 is not an int32, so the engine stored a double per character and the
// loop ran ~20ns/char — 72% of the transcript worker's CPU on a live poll,
// which fingerprints every message of the open session. `| 0` keeps the same
// 32 bits, so the fingerprint is unchanged; only the last step is unsigned.
let hashA = 0
let hashB = 0
let hashChars = 0

/** Mixes a string exactly as before: its length as four little-endian bytes,
 *  then every UTF-16 code unit. */
function mixString(value: string): void {
  const length = value.length
  let a = hashA
  let b = hashB
  let byte = length & 0xff
  a = Math.imul(a ^ byte, HASH_A_PRIME)
  b = (Math.imul(b ^ byte, 33) + HASH_B_OFFSET) | 0
  byte = (length >>> 8) & 0xff
  a = Math.imul(a ^ byte, HASH_A_PRIME)
  b = (Math.imul(b ^ byte, 33) + HASH_B_OFFSET) | 0
  byte = (length >>> 16) & 0xff
  a = Math.imul(a ^ byte, HASH_A_PRIME)
  b = (Math.imul(b ^ byte, 33) + HASH_B_OFFSET) | 0
  byte = (length >>> 24) & 0xff
  a = Math.imul(a ^ byte, HASH_A_PRIME)
  b = (Math.imul(b ^ byte, 33) + HASH_B_OFFSET) | 0
  for (let i = 0; i < length; i += 1) {
    const code = value.charCodeAt(i)
    a = Math.imul(a ^ code, HASH_A_PRIME)
    b = (Math.imul(b ^ code, 33) + HASH_B_OFFSET) | 0
  }
  hashA = a
  hashB = b
  hashChars += length
}

function mixSmallNumber(value: number): void {
  let a = hashA
  let b = hashB
  for (let shift = 0; shift < 32; shift += 8) {
    const byte = (value >>> shift) & 0xff
    a = Math.imul(a ^ byte, HASH_A_PRIME)
    b = (Math.imul(b ^ byte, 33) + HASH_B_OFFSET) | 0
  }
  hashA = a
  hashB = b
}

function hashValue(value: unknown, seen: WeakSet<object>): void {
  if (value === null) {
    mixString('null')
    return
  }

  switch (typeof value) {
    case 'string':
      mixString('string')
      mixString(value)
      return
    case 'number':
      mixString('number')
      mixString(Object.is(value, -0) ? '-0' : String(value))
      return
    case 'boolean':
      mixString(value ? 'true' : 'false')
      return
    case 'undefined':
      mixString('undefined')
      return
    case 'bigint':
      mixString('bigint')
      mixString(value.toString())
      return
    case 'symbol':
      mixString('symbol')
      mixString(value.description ?? '')
      return
    case 'function':
      mixString('function')
      mixString(value.name)
      return
    case 'object':
      break
  }

  if (seen.has(value)) {
    mixString('circular')
    return
  }
  seen.add(value)

  if (Array.isArray(value)) {
    mixString('array')
    mixSmallNumber(value.length)
    for (const item of value) hashValue(item, seen)
    seen.delete(value)
    return
  }

  if (value instanceof Date) {
    mixString('date')
    mixString(value.toISOString())
    seen.delete(value)
    return
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  mixString('object')
  mixSmallNumber(keys.length)
  for (const key of keys) {
    mixString(key)
    hashValue(record[key], seen)
  }
  seen.delete(value)
}

export function compactStableFingerprint(value: unknown): string {
  hashA = HASH_A_INIT | 0
  hashB = HASH_B_INIT | 0
  hashChars = 0
  hashValue(value, new WeakSet<object>())
  return `${hashChars.toString(36)}:${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`
}
