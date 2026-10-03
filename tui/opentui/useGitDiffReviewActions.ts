import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import { copyDiffCellSelection, copyDiffRows, findDiffTextMatches, type DiffCellSelection, type ReviewRow } from './gitDiffReviewActions'
import { diffTextHeight, diffTextWidth } from './gitDiffText'
import type { DiffGeometry } from './gitDiffGeometry'

export type ReviewActionKey = { name: string; sequence: string; ctrl: boolean; shift: boolean }
export function useGitDiffReviewActions({ rows, geometry, scrollRef, cursor, anchor, enabled, scope, keyRef, onCursor, onFocus, onOffset, onClipboardWrite, cellSelection, onClearCellSelection, wrap, columns, tabWidth }: {
  rows: readonly ReviewRow[]; geometry: DiffGeometry; scrollRef: RefObject<ScrollBoxRenderable | null>
  cursor: number; anchor: number | null; enabled: boolean; scope: string
  keyRef: RefObject<(key: ReviewActionKey) => boolean>; onCursor: (index: number) => void; onFocus: () => void
  onOffset: (offset: number) => void; onClipboardWrite?: (text: string) => Promise<void>
  cellSelection?: DiffCellSelection | null
  onClearCellSelection?: () => void
  wrap: boolean; columns: number; tabWidth: number
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [jumpRevision, setJumpRevision] = useState(0)
  const lastJump = useRef('')
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const matches = useMemo(() => enabled ? findDiffTextMatches(rows, query) : [], [enabled, query, rows])
  const selectedIndex = matches.findIndex(match => match.key === selectedKey)
  const index = selectedIndex >= 0 ? selectedIndex : 0
  const active = matches[index]
  const openSearch = useCallback(() => { setEditing(true); setStatus('') }, [])
  const next = useCallback((direction: number) => {
    if (!matches.length) return
    setJumpRevision(value => value + 1)
    setSelectedKey(matches[(index + direction + matches.length) % matches.length]!.key)
  }, [index, matches])
  useEffect(() => { setQuery(''); setEditing(false); setSelectedKey(null); setStatus('') }, [scope])
  useEffect(() => {
    if (!active) { lastJump.current = ''; return }
    const identity = JSON.stringify([scope, query, active.key, jumpRevision])
    if (lastJump.current === identity) return
    lastJump.current = identity
    onCursor(active.row); onFocus()
    const source = rows[active.row]!
    const split = source as import('./pierreDiffView').TuiPierreSplitRow
    const text = split.left || split.right ? (active.side === 'old' ? split.left?.text : split.right?.text) ?? '' : source.text ?? ''
    const prefix = text.slice(0, active.start)
    if (!wrap) onOffset(Math.max(0, diffTextWidth(prefix, tabWidth) - Math.floor(columns / 3)))
    const top = (geometry.rows[active.row]?.top ?? 0) + (wrap ? diffTextHeight(prefix + (Array.from(text.slice(active.start))[0] ?? ''), columns, tabWidth, true) - 1 : 0)
    const timer = setTimeout(() => {
      const scroll = scrollRef.current
      if (scroll && (top < scroll.scrollTop || top >= scroll.scrollTop + scroll.viewport.height)) scroll.scrollTo(top)
    }, 0)
    return () => clearTimeout(timer)
  }, [active?.key, active?.row, scope, query, jumpRevision, columns, geometry, onCursor, onFocus, onOffset, rows, scrollRef, tabWidth, wrap])
  const copy = useCallback(async (side: 'old' | 'new' = 'new') => {
    const text = cellSelection
      ? copyDiffCellSelection(rows, cellSelection, tabWidth)
      : copyDiffRows(rows, anchor ?? cursor, cursor, side)
    if (text === null) { setStatus(side === 'old' ? 'No old-side lines selected' : 'No code selected'); return }
    if (!onClipboardWrite) { setStatus('Clipboard unavailable'); return }
    try {
      await onClipboardWrite(text)
      onClearCellSelection?.()
      if (live.current) setStatus(`Copied ${text.split('\n').length} line${text.includes('\n') ? 's' : ''}`)
    } catch { if (live.current) setStatus('Copy failed; clipboard unavailable') }
  }, [anchor, cellSelection, cursor, onClipboardWrite, onClearCellSelection, rows, tabWidth])
  useLayoutEffect(() => {
    keyRef.current = key => {
      if (!enabled) return false
      if (key.ctrl && (key.name === 'g' || key.name === 'r') && query) { next(key.name === 'r' ? -1 : 1); return true }
      if (editing) {
        if (key.name === 'escape') { setQuery(''); setEditing(false); setSelectedKey(null) }
        else if (key.name === 'return' || key.name === 'tab') setEditing(false)
        else if (key.name === 'backspace') { setQuery(value => Array.from(value).slice(0, -1).join('')); setSelectedKey(null) }
        else if (key.ctrl && key.name === 'u') { setQuery(''); setSelectedKey(null) }
        else if (!key.ctrl && key.sequence && !/[\x00-\x1f\x7f]/.test(key.sequence)) { setQuery(value => value + key.sequence); setSelectedKey(null) }
        return true
      }
      if (key.ctrl && key.name === 'f') { openSearch(); return true }
      if (!key.ctrl && (key.sequence === 'y' || key.sequence === 'Y')) { void copy(key.sequence === 'Y' ? 'old' : 'new'); return true }
      if (key.name === 'escape' && query) { setQuery(''); setSelectedKey(null); return true }
      return false
    }
  }, [copy, editing, enabled, keyRef, next, openSearch, query])
  return { query, editing, status, openSearch, next, copy, matchLabel: query ? `${matches.length ? index + 1 : 0}/${matches.length}` : '' }
}
