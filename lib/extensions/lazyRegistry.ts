/** Promise deduplication with failure eviction. Registration runs no extension code.
 * A resolved lookup uses one Map read; there is no event bus or polling loop.
 */
export function createLazyRegistry<Key extends string, Value>(
  loaders: Readonly<Record<Key, () => Promise<Value>>>,
  validate: (key: Key, value: Value) => void,
) {
  const resolved = new Map<Key, Value>()
  const loading = new Map<Key, Promise<Value>>()
  return {
    /** Inspect active control-plane state without activating an unused extension. */
    peek(key: Key): Value | undefined { return resolved.get(key) },
    async get(key: Key): Promise<Value> {
      if (resolved.has(key)) return resolved.get(key)!
      const pending = loading.get(key)
      if (pending) return pending
      if (!Object.hasOwn(loaders, key)) throw new Error(`Unknown extension: ${key}`)
      const promise = Promise.resolve().then(() => loaders[key]()).then((value) => {
        validate(key, value)
        resolved.set(key, value)
        return value
      }).finally(() => { loading.delete(key) })
      loading.set(key, promise)
      return promise
    },
  }
}
