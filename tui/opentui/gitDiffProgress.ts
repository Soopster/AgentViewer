import type { TuiPierreDiffRow, TuiPierreSplitRow } from './pierreDiffView'

export type DiffProgress = {
  filePath: string
  fileIndex: number
  fileCount: number
  hunkIndex: number
  hunkCount: number
  fileHeader?: string
  hunkHeader?: string
}

type ReviewRow = TuiPierreDiffRow | TuiPierreSplitRow
type Marker = { index: number; path: string; text: string; kind: 'file' | 'hunk' }

function lastMarker(markers: readonly Marker[], index: number, path?: string, kind?: Marker['kind']): Marker | undefined {
  let low = 0
  let high = markers.length - 1
  let found: Marker | undefined
  while (low <= high) {
    const middle = (low + high) >>> 1
    const marker = markers[middle]!
    if (marker.index <= index) {
      if ((!path || marker.path === path) && (!kind || marker.kind === kind)) found = marker
      low = middle + 1
    } else high = middle - 1
  }
  return found
}

/** Derive sticky review context from immutable row positions, without scanning on scroll. */
export function buildDiffProgress(rows: readonly ReviewRow[], filePaths?: readonly string[]): (index: number) => DiffProgress | null {
  const markers: Marker[] = []
  const fileMarkers: Marker[] = []
  const hunksByFile = new Map<string, Marker[]>()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    const path = row.filePath
    if (!path) continue
    if (row.tone === 'file') {
      const marker = { index, path, text: row.text ?? path, kind: 'file' as const }
      markers.push(marker); fileMarkers.push(marker)
    } else if (row.tone === 'hunk') {
      const marker = { index, path, text: row.text ?? '', kind: 'hunk' as const }
      markers.push(marker)
      const hunks = hunksByFile.get(path) ?? []
      hunks.push(marker); hunksByFile.set(path, hunks)
    }
  }
  const uniquePaths = filePaths?.length ? [...new Set(filePaths)] : [...new Set(fileMarkers.map(marker => marker.path))]
  const indexByPath = new Map(uniquePaths.map((path, index) => [path, index] as const))
  return (index: number) => {
    const file = lastMarker(fileMarkers, index)
    const path = file?.path ?? rows[index]?.filePath
    if (!path) return null
    const fileHunks = hunksByFile.get(path) ?? []
    const hunk = lastMarker(fileHunks, index)
    return {
      filePath: path,
      fileIndex: (indexByPath.get(path) ?? 0) + 1,
      fileCount: uniquePaths.length,
      hunkIndex: hunk ? fileHunks.indexOf(hunk) + 1 : 0,
      hunkCount: fileHunks.length,
      fileHeader: file?.text,
      hunkHeader: hunk?.text,
    }
  }
}
