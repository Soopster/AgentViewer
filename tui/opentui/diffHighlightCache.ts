/** Bound retained highlight data by estimated bytes, including empty-entry bookkeeping. */
export class DiffHighlightCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>()
  bytes = 0
  constructor(readonly budget = 8 * 1024 * 1024) {}
  get size() { return this.entries.size }
  peek(key: string): T | undefined { return this.entries.get(key)?.value }
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key); this.entries.set(key, entry)
    return entry.value
  }
  set(key: string, value: T, retainedBytes: number): boolean {
    const bytes = retainedBytes + key.length * 2 + 128
    const previous = this.entries.get(key)
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key) }
    if (bytes > this.budget) return false
    this.entries.set(key, { value, bytes }); this.bytes += bytes
    while (this.bytes > this.budget) {
      const oldest = this.entries.entries().next().value!
      this.entries.delete(oldest[0]); this.bytes -= oldest[1].bytes
    }
    return true
  }
  clear() { this.entries.clear(); this.bytes = 0 }
}

/** Account for retained strings, arrays, maps, and span/HAST objects without serializing them. */
export function estimateHighlightBytes(value: unknown): number {
  let bytes = 0
  const pending: unknown[] = [value]
  while (pending.length) {
    const item = pending.pop()
    if (typeof item === 'string') bytes += item.length * 2 + 24
    else if (item instanceof Map) { bytes += 64 + item.size * 48; for (const [key, value] of item) pending.push(key, value) }
    else if (Array.isArray(item)) { bytes += 32 + item.length * 8; for (const child of item) pending.push(child) }
    else if (item && typeof item === 'object') { bytes += 96; for (const child of Object.values(item)) pending.push(child) }
    else bytes += 8
  }
  return bytes
}
