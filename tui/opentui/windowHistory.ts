// User operations checkpoint the logical layout, never its size-dependent
// visible subset. Nested operations share a checkpoint; no-ops cost no undo.
export class WindowHistory<T> {
  private entries: Array<{ key: string; value: T }> = []

  constructor(private readonly keyOf: (value: T) => string, private readonly limit = 50) {}

  clear(): void { this.entries = []; this.future = [] }

  private future: T[] = []

  redo(current: T): T | null {
    if (!this.future.length) return null
    const next = this.future.pop()!
    this.entries.push({ key: this.keyOf(current), value: current })
    return next
  }

  checkpoint(value: T): void {
    this.future = []
    const key = this.keyOf(value)
    if (this.entries.at(-1)?.key === key) return
    this.entries.push({ key, value })
    if (this.entries.length > this.limit) this.entries.shift()
  }

  undo(current: T): T | null {
    const key = this.keyOf(current)
    while (this.entries.length) {
      const entry = this.entries.pop()!
      if (entry.key !== key) { this.future.push(current); return entry.value }
    }
    return null
  }
}
