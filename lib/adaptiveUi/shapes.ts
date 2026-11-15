// Calls nothing draws specially, tallied by shape, with a few redacted samples
// for designing a card. Pure and bounded: the plugin owns when to persist it.
export type ShapeSample = { readonly input: Record<string, unknown>; readonly result?: { readonly text: string; readonly isError: boolean } }
export type ShapeRecord = {
  readonly key: string
  readonly tool: string
  readonly mcpServer?: string
  readonly inputKeys: readonly string[]
  readonly count: number
  readonly firstSeen: number
  readonly lastSeen: number
  readonly samples: readonly ShapeSample[]
  readonly dismissed?: boolean
}
export const SHAPE_LIMITS = Object.freeze({ shapes: 200, samples: 3, string: 160, depth: 3, entries: 12, resultChars: 1_200 })

const SECRET_KEY = /token|secret|passw|authorization|api[-_]?key|credential|cookie|bearer/i

export function shapeKey(tool: string, inputKeys: readonly string[]): string { return `${tool}|${[...inputKeys].sort().join(',')}` }

/** Input reduced to what a designer needs: structure and short example values, with secrets removed. */
export function redactForSample(value: unknown, depth = 0): unknown {
  const L = SHAPE_LIMITS
  if (typeof value === 'string') return value.length > L.string ? `${value.slice(0, L.string)}…` : value
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= L.depth) return Array.isArray(value) ? '[…]' : '{…}'
  if (Array.isArray(value)) return value.slice(0, 3).map(item => redactForSample(item, depth + 1))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, L.entries).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[redacted]' : redactForSample(item, depth + 1)]))
  return undefined
}

/** Redact a result's text: if it is JSON, redact its structure; otherwise keep a short prefix. */
export function redactResultText(text: string): string {
  const L = SHAPE_LIMITS
  if (/^\s*[[{]/.test(text) && text.length <= 20_000) { try { return JSON.stringify(redactForSample(JSON.parse(text))).slice(0, L.resultChars) } catch { /* not JSON */ } }
  return text.slice(0, L.resultChars)
}

export class ShapeBook {
  private readonly shapes = new Map<string, ShapeRecord>()
  constructor(initial: readonly ShapeRecord[] = []) { for (const record of initial.slice(0, SHAPE_LIMITS.shapes)) this.shapes.set(record.key, record) }

  record(input: { tool: string; mcpServer?: string; inputKeys: readonly string[]; sample?: ShapeSample; now?: number }): ShapeRecord {
    const key = shapeKey(input.tool, input.inputKeys)
    const now = input.now ?? Date.now()
    const prev = this.shapes.get(key)
    let samples = prev?.samples ?? []
    // A finished call is a better sample than a running one: replace a result-less sample with one that has a result.
    if (input.sample && samples.length < SHAPE_LIMITS.samples && !samples.some(s => JSON.stringify(s.input) === JSON.stringify(input.sample!.input))) samples = [...samples, input.sample]
    else if (input.sample?.result && samples.some(s => !s.result)) samples = samples.map(s => !s.result && JSON.stringify(s.input) === JSON.stringify(input.sample!.input) ? input.sample! : s)
    const next: ShapeRecord = { key, tool: input.tool, ...(input.mcpServer ? { mcpServer: input.mcpServer } : {}), inputKeys: [...input.inputKeys].sort(), count: (prev?.count ?? 0) + 1, firstSeen: prev?.firstSeen ?? now, lastSeen: now, samples, ...(prev?.dismissed ? { dismissed: true } : {}) }
    this.shapes.delete(key); this.shapes.set(key, next)
    while (this.shapes.size > SHAPE_LIMITS.shapes) this.shapes.delete(this.shapes.keys().next().value!)
    return next
  }
  /** Fold in records another isolate persisted: a shape is taken from the other side only when it was seen more recently. */
  merge(records: readonly ShapeRecord[]): void {
    for (const record of records.slice(0, SHAPE_LIMITS.shapes)) {
      const mine = this.shapes.get(record.key)
      if (!mine || record.lastSeen > mine.lastSeen) this.shapes.set(record.key, mine?.dismissed && !record.dismissed ? { ...record, dismissed: true } : record)
    }
    while (this.shapes.size > SHAPE_LIMITS.shapes) this.shapes.delete(this.shapes.keys().next().value!)
  }
  dismiss(key: string, dismissed = true): void { const prev = this.shapes.get(key); if (prev) this.shapes.set(key, { ...prev, ...(dismissed ? { dismissed: true } : { dismissed: undefined }) }) }
  forget(key: string): void { this.shapes.delete(key) }
  list(): ShapeRecord[] { return [...this.shapes.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen) }
  get(key: string): ShapeRecord | undefined { return this.shapes.get(key) }
}
