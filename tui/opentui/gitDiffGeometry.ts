import type { TuiPierreDiffRow, TuiPierreSplitRow } from './pierreDiffView'

export type DiffGeometryRow = { keys: string[]; top: number; height: number }
export type DiffGeometry = { rows: DiffGeometryRow[]; total: number; byKey: Map<string, number> }
export type DiffViewportAnchor = { keys: string[]; offset: number; fallbackTop: number }

/** Share source-line identities between unified and split rows. */
export function diffRowKeys(row: TuiPierreDiffRow | TuiPierreSplitRow): string[] {
  const split = row as TuiPierreSplitRow
  const unified = row as TuiPierreDiffRow
  const oldLine = split.left?.lineNum ?? unified.oldLine
  const newLine = split.right?.lineNum ?? unified.newLine
  if (row.contextGap) return [`gap:${row.contextGap.id}`]
  const prefix = row.filePath ? `${row.filePath}\0` : ''
  return [newLine == null ? null : `new:${newLine}`, oldLine == null ? null : `old:${oldLine}`]
    .filter((key): key is string => key !== null)
    .concat(oldLine == null && newLine == null ? [row.tone === 'file' ? 'file' : `${row.tone}:${row.text ?? ''}`] : [])
    .map(key => prefix + key)
}

/** Include hidden headers and inline note heights in the same coordinate system. */
export function buildDiffGeometry(entries: Array<{ keys: string[]; height: number }>): DiffGeometry {
  let total = 0
  const byKey = new Map<string, number>()
  const rows = entries.map(({ keys, height }, index) => {
    const row = { keys, height, top: total }
    total += height
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, index)
    return row
  })
  return { rows, total, byKey }
}

/** Find the row covering a terminal offset without scanning the full diff. */
export function diffRowAt(geometry: DiffGeometry, top: number): number {
  let lo = 0
  let hi = geometry.rows.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const row = geometry.rows[mid]!
    if (row.top + row.height <= top) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Mount only viewport rows plus overscan, preserving the full scroll extent. */
export function diffRowWindow(geometry: DiffGeometry, top: number, height: number) {
  const overscan = Math.max(8, height)
  const start = diffRowAt(geometry, Math.max(0, top - overscan))
  const end = Math.min(geometry.rows.length, diffRowAt(geometry, top + height + overscan) + 1)
  const before = geometry.rows[start]?.top ?? geometry.total
  const last = geometry.rows[end - 1]
  return { start, end, before, after: Math.max(0, geometry.total - (last ? last.top + last.height : before)) }
}

export function captureDiffAnchor(geometry: DiffGeometry, top: number, preferredKey?: string): DiffViewportAnchor {
  const row = geometry.rows[diffRowAt(geometry, top)]
  const keys = row?.keys ?? []
  const ordered = preferredKey && keys.includes(preferredKey) ? [preferredKey, ...keys.filter(key => key !== preferredKey)] : keys
  return { keys: ordered, offset: row ? top - row.top : 0, fallbackTop: top }
}

export function resolveDiffAnchor(geometry: DiffGeometry, anchor: DiffViewportAnchor): number {
  for (const key of anchor.keys) {
    const index = geometry.byKey.get(key)
    if (index == null) continue
    const row = geometry.rows[index]!
    return row.top + Math.min(anchor.offset, Math.max(0, row.height - 1))
  }
  return Math.min(anchor.fallbackTop, Math.max(0, geometry.total - 1))
}
