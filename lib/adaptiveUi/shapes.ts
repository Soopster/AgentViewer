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

/**
 * A result kept as a sample. JSON is kept AS JSON: the structure is what a card is designed against, and a
 * string cut mid-object no longer parses, so a card previewed against it would read every field as empty.
 * When the redacted structure is too large it is thinned (shallower, fewer entries, shorter strings) until
 * it fits; text that is not JSON keeps a prefix.
 */
const THINNING = [{ depth: 3, entries: 12, string: 160 }, { depth: 3, entries: 8, string: 80 }, { depth: 2, entries: 8, string: 60 }, { depth: 2, entries: 5, string: 40 }]
export function redactResultText(text: string): string {
  const L = SHAPE_LIMITS
  if (/^\s*[[{]/.test(text) && text.length <= 200_000) {
    try { return redactResultJson(JSON.parse(text)) } catch { /* not JSON: fall through to a text prefix */ }
  }
  return text.slice(0, L.resultChars)
}

/** An already-parsed result, redacted and thinned until it fits; null when even the thinnest form is too large. */
export function redactResultJson(parsed: unknown): string {
  for (const level of THINNING) {
    const out = JSON.stringify(redactWith(parsed, 0, level))
    if (out.length <= SHAPE_LIMITS.resultChars) return out
  }
  return JSON.stringify(redactWith(parsed, 0, { depth: 1, entries: 3, string: 30 })).slice(0, SHAPE_LIMITS.resultChars)
}

function redactWith(value: unknown, depth: number, level: { depth: number; entries: number; string: number }): unknown {
  if (typeof value === 'string') return value.length > level.string ? `${value.slice(0, level.string)}…` : value
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= level.depth) return Array.isArray(value) ? [] : {}
  if (Array.isArray(value)) return value.slice(0, 3).map(item => redactWith(item, depth + 1, level))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, level.entries).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[redacted]' : redactWith(item, depth + 1, level)]))
  return undefined
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
  /** A tool known from history: raises its count to what history saw and tops its samples up, never lowering either. */
  seed(input: { tool: string; mcpServer?: string; inputKeys: readonly string[]; count: number; firstSeen: number; lastSeen: number; samples: readonly ShapeSample[] }): void {
    const key = shapeKey(input.tool, input.inputKeys)
    const prev = this.shapes.get(key)
    const have = prev?.samples ?? []
    const merged = [...have]
    for (const sample of input.samples) if (merged.length < SHAPE_LIMITS.samples && !merged.some(entry => JSON.stringify(entry.input) === JSON.stringify(sample.input))) merged.push(sample)
    this.shapes.delete(key)
    this.shapes.set(key, { key, tool: input.tool, ...(input.mcpServer ? { mcpServer: input.mcpServer } : {}), inputKeys: [...input.inputKeys].sort(), count: Math.max(prev?.count ?? 0, input.count), firstSeen: Math.min(prev?.firstSeen ?? input.firstSeen, input.firstSeen), lastSeen: Math.max(prev?.lastSeen ?? 0, input.lastSeen), samples: merged, ...(prev?.dismissed ? { dismissed: true } : {}) })
    while (this.shapes.size > SHAPE_LIMITS.shapes) this.shapes.delete(this.shapes.keys().next().value!)
  }
  dismiss(key: string, dismissed = true): void { const prev = this.shapes.get(key); if (prev) this.shapes.set(key, { ...prev, ...(dismissed ? { dismissed: true } : { dismissed: undefined }) }) }
  forget(key: string): void { this.shapes.delete(key) }
  list(): ShapeRecord[] { return [...this.shapes.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen) }
  get(key: string): ShapeRecord | undefined { return this.shapes.get(key) }
}
