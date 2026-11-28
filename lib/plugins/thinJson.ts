const THIN = { depth: 8, items: 100, keys: 100, string: 4_000, nodes: 20_000 }
/** A parsed value reduced to a bounded size, keeping its shape: what a hook is handed as `result.json`. */
export function thinJson(value: unknown): unknown {
  let nodes = 0
  const walk = (v: unknown, depth: number): unknown => {
    if (++nodes > THIN.nodes) return undefined
    if (typeof v === 'string') return v.length > THIN.string ? `${v.slice(0, THIN.string)}…` : v
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v
    if (depth >= THIN.depth) return Array.isArray(v) ? [] : {}
    if (Array.isArray(v)) return v.slice(0, THIN.items).map(item => walk(item, depth + 1))
    if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, THIN.keys).map(([key, item]) => [key, walk(item, depth + 1)]))
    return undefined
  }
  return walk(value, 0)
}

