/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { GitKeyEvent, GitPopoverProps } from './GitPopover'
import { browseBlob, browseDirectory, type BrowseEntry } from '../../../lib/git/browse'
import { GitDivider } from './GitDivider'
import { DiffCodeText, useWindowVisible } from '../../../tui/opentui/shell/sdkDiff'

type Props = { cwd: string; revision: string | null | undefined; theme: GitPopoverProps['theme']; width: number; height: number; refreshRevision?: string | number; registerKeys: GitPopoverProps['onKeyHandlerReady'] }
export function RevisionTree({ cwd, revision, theme, width, height, refreshRevision, registerKeys }: Props) {
  const visible = useWindowVisible()
  const [directories, setDirectories] = useState<Map<string, BrowseEntry[]>>(() => new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [cursor, setCursor] = useState(0)
  const [focus, setFocus] = useState<'tree' | 'preview'>('tree')
  const [content, setContent] = useState('Select a file to preview.')
  const [selectedPath, setSelectedPath] = useState('')
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [hidden, setHidden] = useState(false)
  const [treeWidth, setTreeWidth] = useState(30)
  const treeScroll = useRef<ScrollBoxRenderable>(null)
  const previewScroll = useRef<ScrollBoxRenderable>(null)
  const generation = useRef(0)
  const pending = useRef(new Set<string>())
  useEffect(() => { generation.current++; return () => { generation.current++ } }, [cwd, revision])
  const load = useCallback(async (path: string) => {
    if (revision === undefined || pending.current.has(path)) return
    const token = generation.current
    pending.current.add(path)
    try {
      const children = await browseDirectory(cwd, revision, path)
      if (token === generation.current) setDirectories(old => new Map(old).set(path, children))
    } catch (e) { if (token === generation.current) setError(String(e)) }
    finally { pending.current.delete(path) }
  }, [cwd, revision])
  useEffect(() => { if (visible) for (const path of expanded) void load(path) }, [visible, refreshRevision, expanded, load])
  const rows = useMemo(() => {
    const result: Array<{ entry: BrowseEntry; depth: number }> = []
    const visit = (path: string, depth: number) => { for (const entry of directories.get(path) ?? []) { result.push({ entry, depth }); if (entry.kind === 'tree' && expanded.has(entry.path)) visit(entry.path, depth + 1) } }
    visit('', 0); return result
  }, [directories, expanded])
  const choose = useCallback((index: number, toggle = false) => {
    setCursor(index)
    const entry = rows[index]?.entry
    if (!entry) return
    setError('')
    if (entry.kind === 'tree') {
      if (toggle) { setExpanded(old => { const next = new Set(old); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next }); if (!directories.has(entry.path)) void load(entry.path) }
      return
    }
    setSelectedPath(entry.path); if (entry.path !== selectedPath) setContent('Loading…'); setOffset(0); setTop(0); previewScroll.current?.scrollTo(0)

  }, [rows, directories, selectedPath, load])
  const selectedEntry = [...directories.values()].flat().find(entry => entry.path === selectedPath)
  useEffect(() => {
    if (!visible || !selectedEntry) return
    let live = true
    void browseBlob(cwd, selectedEntry).then(text => { if (live) setContent(text) }).catch(e => { if (live) { setContent('File unavailable.'); setError(String(e)) } })
    return () => { live = false }
  }, [cwd, visible, selectedEntry, refreshRevision])
  const handle = useCallback((key: GitKeyEvent) => {
    if (key.name === 'escape') return false
    if (key.name === 'tab') { setFocus(value => value === 'tree' ? 'preview' : 'tree'); return }
    if (key.sequence === '-') { setHidden(v => !v); return }
    if (key.sequence === '[' || key.sequence === ']') { setTreeWidth(v => Math.max(16, Math.min(width - 16, v + (key.sequence === '[' ? -4 : 4)))); return }
    const delta = key.name === 'down' || key.sequence === 'j' ? 1 : key.name === 'up' || key.sequence === 'k' ? -1 : key.name === 'pagedown' ? height - 2 : key.name === 'pageup' ? 2 - height : 0
    if (delta) {
      if (focus === 'preview' || hidden) previewScroll.current?.scrollBy(delta)
      else choose(Math.max(0, Math.min(rows.length - 1, cursor + delta)))
      return
    }
    if (focus === 'tree' && !hidden) {
      if (key.name === 'return' || key.name === 'right' || key.sequence === 'l') choose(cursor, true)
      if (key.name === 'left' || key.sequence === 'h') {
        const entry = rows[cursor]?.entry
        if (entry?.kind === 'tree' && expanded.has(entry.path)) setExpanded(old => { const next = new Set(old); next.delete(entry.path); return next })
        else if (entry) { const parent = entry.path.split('/').slice(0, -1).join('/'); const index = rows.findIndex(row => row.entry.path === parent); if (index >= 0) setCursor(index) }
      }
    } else if (key.name === 'left' || key.name === 'right') setOffset(v => Math.max(0, v + (key.name === 'left' ? -8 : 8)))
  }, [choose, cursor, expanded, focus, height, hidden, rows, width])
  useEffect(() => registerKeys(handle), [handle, registerKeys])
  useEffect(() => { setCursor(value => Math.min(value, Math.max(0, rows.length - 1))) }, [rows.length])
  useEffect(() => { treeScroll.current?.scrollTo(Math.max(0, cursor - height + 4)) }, [cursor, height])
  const leftW = hidden ? 0 : Math.max(12, Math.min(treeWidth, Math.floor(width * .45)))
  const lines = useMemo(() => content.split('\n'), [content])
  // Preview rendering stays bounded even for a 1 MiB blob.
  const [top, setTop] = useState(0)
  useEffect(() => {
    const bar = previewScroll.current?.verticalScrollBar
    if (!bar) return
    const changed = ({ position }: { position: number }) => setTop(Math.floor(position))
    bar.on('change', changed)
    return () => { bar.off('change', changed) }
  }, [])
  const visibleLines = Math.max(1, height - 3)
  return <box width={width} height={height} flexDirection="column">
    <box height={1}><text fg={theme.muted} wrapMode="none">{error || `${selectedPath || 'File Tree'} · Tab focus · - hide tree · [ ] resize`}</text></box>
    <box flexGrow={1} minHeight={0} flexDirection="row">
      {!hidden ? <box width={leftW} flexShrink={0} flexDirection="column">
        <scrollbox ref={treeScroll} flexGrow={1} scrollY>{rows.map(({ entry, depth }, index) => <box key={entry.path} height={1} flexShrink={0} backgroundColor={cursor === index ? theme.surface3 : undefined} onMouseDown={e => { e.stopPropagation(); setFocus('tree'); choose(index, true) }}><text fg={entry.kind === 'tree' ? theme.cyan : theme.text} wrapMode="none">{`${'  '.repeat(depth)}${entry.kind === 'tree' ? expanded.has(entry.path) ? '▼' : '▶' : entry.kind === 'submodule' ? '▣' : ' '} ${entry.name.replace(/[\x00-\x1f\x7f]/g, ' ')}`}</text></box>)}{!rows.length ? <text fg={theme.dim}>{revision === undefined ? 'Select a commit.' : directories.has('') ? 'Empty tree.' : 'Loading…'}</text> : null}</scrollbox>
        <box position="absolute" top={0} right={0} width={1} height={Math.max(1, height - 1)}><GitDivider id="git-tree-divider" vertical width={1} height={Math.max(1, height - 1)} size={leftW} theme={theme} onResize={value => setTreeWidth(Math.max(12, Math.min(value, Math.floor(width * .45))))} /></box>
      </box> : null}
      <scrollbox ref={previewScroll} flexGrow={1} minWidth={0} scrollY onMouseDown={() => setFocus('preview')}>
        {top > 0 ? <box height={Math.min(top, lines.length)} flexShrink={0} /> : null}
        {lines.slice(top, top + visibleLines + 4).map((line, index) => <box key={top + index} height={1} flexShrink={0}><DiffCodeText text={`${String(top + index + 1).padStart(5)} ${line}`} columns={Math.max(1, width - leftW - 2)} tabWidth={4} wrap={false} offset={offset} fg={theme.text} /></box>)}
        <box height={Math.max(0, lines.length - top - visibleLines - 4)} flexShrink={0} />
      </scrollbox>
    </box>
  </box>
}
