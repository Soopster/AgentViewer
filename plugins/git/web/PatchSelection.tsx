'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PatchRow } from '@/lib/git/workspaceTypes'

const ROW_HEIGHT = 24
export function PatchSelection({ rows, selected, busy, toggle }: { rows: PatchRow[]; selected: Set<number>; busy: boolean; toggle: (indices: number[]) => void }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(() => setHeight(node.clientHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const hunks = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const row of rows) if (row.changed) {
      const indices = map.get(row.hunk) ?? []
      indices.push(row.index); map.set(row.hunk, indices)
    }
    return map
  }, [rows])
  const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - 10)
  const end = Math.min(rows.length, Math.ceil((top + height) / ROW_HEIGHT) + 10)
  return <div ref={viewport} className="git-workspace-patch" role="region" aria-label="Select patch lines" tabIndex={0} onScroll={event => setTop(event.currentTarget.scrollTop)}>
    {hunks.size === 0 ? <p>No selectable text hunks. Use the whole-file action for binary or metadata changes.</p> : null}
    <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative', minWidth: '100%' }}>
      {rows.slice(start, end).map(row => <div key={row.index} style={{ position: 'absolute', top: row.index * ROW_HEIGHT, height: ROW_HEIGHT, minWidth: '100%' }}>
        {row.text.startsWith('@@ ') ? <button type="button" disabled={busy} className="git-workspace-hunk" onClick={() => toggle(hunks.get(row.hunk) ?? [])}>{row.text} · toggle hunk</button>
          : row.changed ? <label className={row.text.startsWith('+') ? 'addition' : 'deletion'}><input type="checkbox" checked={selected.has(row.index)} disabled={busy} onChange={() => toggle([row.index])} aria-label={`Select ${row.text.startsWith('+') ? 'added' : 'removed'} line ${row.newLine ?? row.oldLine}`} /><code>{row.text}</code></label>
            : <code>{row.text || ' '}</code>}
      </div>)}
    </div>
  </div>
}
