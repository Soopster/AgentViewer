// Reuse the caller's unchanged objects. Suffix deliveries avoid cloning those
// objects across the worker boundary; full deliveries remain safe on cache miss.
export function restoreDeliveredPrefix<T>(
  previous: T[] | undefined,
  fresh: T[],
  prefix: number,
  suffixOnly = false,
): T[] {
  if (suffixOnly) {
    if (!previous || !Number.isInteger(prefix) || prefix < 0 || prefix > previous.length) {
      throw new Error('Invalid transcript delivery prefix')
    }
    if (prefix === previous.length && fresh.length === 0) return previous
    const result = new Array<T>(prefix + fresh.length)
    for (let i = 0; i < prefix; i++) result[i] = previous[i]
    for (let i = 0; i < fresh.length; i++) result[prefix + i] = fresh[i]
    return result
  }
  if (!previous || prefix <= 0) return fresh
  const count = Math.min(prefix, previous.length, fresh.length)
  if (count <= 0) return fresh
  if (count === fresh.length && previous.length === fresh.length) return previous
  const result = fresh.slice()
  for (let i = 0; i < count; i++) result[i] = previous[i]
  return result
}
