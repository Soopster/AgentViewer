// User operations checkpoint the logical layout, never its size-dependent
// visible subset. Nested operations share a checkpoint; no-ops cost no undo.
export class WindowHistory<T> {
  private entries: Array<{ key: string; value: T }> = []

  constructor(private readonly keyOf: (value: T) => string, private readonly limit = 50) {}

  checkpoint(value: T): void {
    const key = this.keyOf(value)
    if (this.entries.at(-1)?.key === key) return
    this.entries.push({ key, value })
    if (this.entries.length > this.limit) this.entries.shift()
  }

  undo(current: T): T | null {
    const key = this.keyOf(current)
    while (this.entries.length) {
      const entry = this.entries.pop()!
      if (entry.key !== key) return entry.value
    }
    return null
  }
}
