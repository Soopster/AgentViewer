/** @jsxImportSource @opentui/react */
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import { buildSelectionAskPrompt } from '../../../lib/selectionAsk'
import { fitText } from '../textLayout'
import { EngineeringAction as Action } from './EngineeringAction'
import { PaneResizeHandle } from '../paneResize'
import type { EngineeringFile } from './repository'
import { diffAppearance, diffRowKeys, stackDiffHunkAt, stackDiffHunks, StackDiffView, useStackDiffModel } from '../diff'
import { useWorkspaceState } from '../workspaceContext'
import { sortTreePaths } from '../pierreLight'
import { buildGitFileTree, gitFileTreeDirectories, type GitFileTreeNode } from '../gitFileTree'
import { nearestDiffContextGap } from '../gitDiffContext'

/** What the inspector's key handler asks of the diff it does not own. */
export type EngineeringChangesHandle = {
  /** Step the hunk cursor; false when the file has no hunks. */
  handleTreeKey: (key: string) => boolean
  fileCursor: () => string | null
  moveHunk: (step: number) => boolean
  /** First new-side line of the hunk under the cursor, for opening the editor there. */
  hunkLine: () => number | null
  /** Show more omitted context next to the cursor; false when there is none. */
  expandContext: () => boolean
}

type Props = {
  files: EngineeringFile[]; width: number; height: number; theme: TuiThemePalette
  listRowsPreference?: number
  selectedPath: string | null
  /** A unified diff of the selected file (an untracked file diffed against /dev/null). */
  patch: string; evidence: TuiTranscriptCard[]
  requestEvidence?: TuiTranscriptCard
  onEvidence?: () => void
  /** Repository the diff came from; omitted context is read from it. */
  root?: string
  wrap?: boolean
  /** Repository-relative paths this session edited, marked ● in the list. */
  sessionFiles?: ReadonlySet<string>
  /** Changes shown when the list is narrowed to this session's files. */
  totalFiles?: number
  scope?: 'all' | 'session'
  onToggleScope?: () => void
  onTreeFocus?: () => void
  handleRef?: Ref<EngineeringChangesHandle | null>
  focused: boolean; editing: boolean
  onSelect: (path: string, index: number) => void
  onReview: () => void; onJump: (key: string) => void
  onBeginEdit: () => void; onEndEdit: () => void; onAppend: (text: string) => void
}

/** Inspector chrome above and below the diff: panel border, title, tabs and footer. */
const INSPECTOR_CHROME_ROWS = 5

export function EngineeringChanges(props: Props) {
  const { files, theme, width, selectedPath } = props
  const [comment, setComment] = useWorkspaceState(`engineering:comment:${props.root ?? ''}`, '', false)
  const [hunk, setHunk] = useWorkspaceState<{ path: string | null; index: number; revision: number }>(`engineering:hunk:${props.root ?? ''}`, { path: null, index: 0, revision: 0 }, false)
  const list = useRef<ScrollBoxRenderable | null>(null)
  const [directoryState, setDirectoryState] = useWorkspaceState<{ root: string | undefined; collapsed: Set<string> }>(`engineering:tree:${props.root ?? ''}`, () => ({ root: props.root, collapsed: new Set() }), false)
  const [treeCursor, setTreeCursor] = useWorkspaceState<string | null>(`engineering:tree-cursor:${props.root ?? ''}`, null, false)
  const entries = useMemo(() => files.map(file => ({ path: file.path, x: file.status[0] ?? ' ', y: file.status[1] ?? ' ' })), [files])
  const nodes = useMemo(() => {
    const expanded = gitFileTreeDirectories(entries)
    if (directoryState.root === props.root) for (const path of directoryState.collapsed) expanded.delete(path)
    return buildGitFileTree(entries, expanded)
  }, [entries, directoryState, props.root])
  const nodeKey = (node: GitFileTreeNode) => `${node.kind}:${node.path}`
  const cursorIndex = Math.max(0, nodes.findIndex(node => nodeKey(node) === (treeCursor ?? `file:${selectedPath}`)))
  const cursorNode = nodes[cursorIndex]
  const filesByPath = useMemo(() => new Map(files.map((file, index) => [file.path, { file, index }])), [files])
  const chooseNode = (node: GitFileTreeNode) => {
    setTreeCursor(nodeKey(node))
    if (node.kind === 'file') props.onSelect(node.path, filesByPath.get(node.path)!.index)
  }
  const toggleDirectory = (node: Extract<GitFileTreeNode, { kind: 'dir' }>) => {
    setDirectoryState(previous => {
      const collapsed = new Set(previous.root === props.root ? previous.collapsed : [])
      for (const path of node.chainPaths) { if (node.expanded) collapsed.add(path); else collapsed.delete(path) }
      return { root: props.root, collapsed }
    })
  }
  const previousSelection = useRef(selectedPath)
  useEffect(() => {
    const changed = previousSelection.current !== selectedPath
    previousSelection.current = selectedPath
    if (!changed && treeCursor) return
    setTreeCursor(selectedPath ? `file:${selectedPath}` : null)
    if (!selectedPath) return
    // An external file jump reveals its ancestors; ordinary polling preserves folds.
    const parents = gitFileTreeDirectories([{ path: selectedPath, x: ' ', y: ' ' }])
    setDirectoryState(previous => {
      if (previous.root !== props.root) return { root: props.root, collapsed: new Set() }
      if (![...parents].some(path => previous.collapsed.has(path))) return previous
      return { root: props.root, collapsed: new Set([...previous.collapsed].filter(path => !parents.has(path))) }
    })
  }, [selectedPath, props.root])
  const handleTreeKey = (key: string): boolean => {
    if (key === 'down' || key === 'j' || key === 'up' || key === 'k') {
      const step = key === 'down' || key === 'j' ? 1 : -1
      const node = nodes[Math.max(0, Math.min(nodes.length - 1, cursorIndex + step))]
      if (node) chooseNode(node)
      return true
    }
    if (key === 'return' || key === ' ') {
      if (cursorNode?.kind === 'dir') toggleDirectory(cursorNode)
      else if (cursorNode) chooseNode(cursorNode)
      return true
    }
    if (key === 'left' || key === 'h') {
      if (cursorNode?.kind === 'dir' && cursorNode.expanded) toggleDirectory(cursorNode)
      else if (cursorNode && cursorNode.depth > 0) {
        const parent = nodes.slice(0, cursorIndex).findLast(node => node.kind === 'dir' && node.depth === cursorNode.depth - 1)
        if (parent) chooseNode(parent)
      }
      return true
    }
    if (key === 'right' || key === 'l') {
      if (cursorNode?.kind === 'dir' && !cursorNode.expanded) toggleDirectory(cursorNode)
      else if (cursorNode?.kind === 'dir' && nodes[cursorIndex + 1]) chooseNode(nodes[cursorIndex + 1]!)
      return true
    }
    return false
  }
  const selectedFile = files.find(file => file.path === selectedPath)
  const model = useStackDiffModel({
    diffText: props.patch, documentKey: `engineering:${props.root ?? ''}:${selectedPath ?? ''}`, cwd: props.root ?? process.cwd(),
    width: width - 2, appearance: diffAppearance(theme), wrap: props.wrap ?? true, hideFileRows: true,
  })
  const hunks = useMemo(() => stackDiffHunks(model), [model.rows, model.hunkRows])
  const hunkIndex = hunk.path === selectedPath ? Math.min(hunk.index, Math.max(0, hunks.length - 1)) : 0
  const cursorRow = hunks[hunkIndex]?.row ?? null
  useImperativeHandle(props.handleRef, () => ({
    handleTreeKey,
    fileCursor: () => cursorNode?.kind === 'file' ? cursorNode.path : null,
    moveHunk: step => {
      if (!hunks.length) return false
      setHunk(previous => ({ path: selectedPath, index: Math.max(0, Math.min(hunks.length - 1, hunkIndex + step)), revision: previous.revision + 1 }))
      return true
    },
    hunkLine: () => hunks[hunkIndex]?.newStart ?? null,
    expandContext: () => {
      const gap = cursorRow == null ? undefined : nearestDiffContextGap(model.rows, cursorRow, model.expansions, false)
      if (!gap) return false
      model.changeContext(gap)
      return true
    },
  }), [hunks, hunkIndex, selectedPath, cursorRow, model, nodes, cursorIndex, props.onSelect, directoryState])

  const listRows = Math.max(1, Math.min(props.listRowsPreference ?? Math.min(Math.max(nodes.length, 1), 14, Math.floor(props.height * .3)), Math.max(1, props.height - 22)))
  const evidence = props.requestEvidence ? [props.requestEvidence, ...props.evidence.slice(-1)] : props.evidence.slice(-2)
  // summary, review action, list, selected-file row (2), evidence, comment (2)
  const diffRows = Math.max(3, props.height - INSPECTOR_CHROME_ROWS - (3 + listRows + 2 + evidence.length + 2 + (props.onEvidence ? 1 : 0)))
  useEffect(() => {
    const index = cursorIndex
    const scroll = list.current
    if (!scroll || index < 0) return
    if (index < scroll.scrollTop) scroll.scrollTo(index)
    else if (index >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(Math.max(0, index - scroll.viewport.height + 1))
  }, [cursorIndex, nodes, listRows])

  const submitComment = () => {
    if (!comment.trim() || !selectedPath) return
    const current = hunks[hunkIndex]
    const prompt = buildSelectionAskPrompt({
      intent: 'ask', filePath: selectedPath,
      startLine: current?.newStart ?? 1, endLine: current?.newEnd ?? 1,
      code: current?.text ?? props.patch, isDiff: true,
      origin: current ? `Engineering review, hunk ${hunkIndex + 1}/${hunks.length} against HEAD` : 'Engineering review',
    })
    props.onAppend(prompt.replace(/Question: $/, `Question: ${comment.trim()}`))
    setComment(''); props.onEndEdit()
  }

  const fileOrder = useMemo(() => sortTreePaths(files.map(file => file.path)), [files])
  const sessionCount = props.sessionFiles ? files.filter(file => props.sessionFiles!.has(file.path)).length : 0
  const total = props.totalFiles ?? files.length
  const summary = props.scope === 'session'
    ? ` Mine · ${files.length} of ${total} changed files`
    : ` ${total} changed file${total === 1 ? '' : 's'}${sessionCount ? ` · ● ${sessionCount} mine` : ''}`
  const jumpRow = hunk.revision > 0 && cursorRow != null ? model.rows[cursorRow] : undefined
  return <box flexGrow={1} minHeight={0} flexDirection="column">
    <box height={1} flexShrink={0} flexDirection="row">
      <text fg={theme.dim} wrapMode="none">{fitText(summary, Math.max(8, width - 2 - (props.onToggleScope ? 10 : 0)))}</text>
      {props.onToggleScope ? <Action theme={theme} label={props.scope === 'session' ? 'all (m)' : 'mine (m)'} onPress={props.onToggleScope} /> : null}
    </box>
    <Action theme={theme} label="Open full Git review / hunk comments (r)" onPress={props.onReview} />
    <text height={1} flexShrink={0} fg={props.focused ? theme.cyan : theme.muted} wrapMode="none">{` Files ${Math.max(0, fileOrder.indexOf(selectedPath ?? '') + 1)}/${files.length}`}</text>
    {props.onEvidence ? <Action id="engineering-file-evidence" theme={theme} label="Evidence for selected file (v)" onPress={props.onEvidence} /> : null}
    <scrollbox id="engineering-file-tree" ref={list} height={listRows} flexShrink={0}>
      {nodes.map((node, index) => {
        const indent = '  '.repeat(node.depth)
        const selected = index === cursorIndex
        const file = node.kind === 'file' ? filesByPath.get(node.path)!.file : null
        const status = file?.status.trim() || '??'
        const color = !file ? theme.muted : status === '??' || status.includes('D') ? theme.red : status.includes('A') ? theme.green : theme.amber
        const label = !file ? `${indent}${node.kind === 'dir' && node.expanded ? '▼' : '▶'} ${node.name}` : `${indent}${status === '??' ? '?' : status} ${node.name}${props.sessionFiles?.has(node.path) ? ' ●' : ''}`
        return <box key={nodeKey(node)} id={`engineering-tree:${nodeKey(node)}`} height={1} flexShrink={0} flexDirection="row" backgroundColor={selected ? theme.surface3 : undefined}
          onMouseDown={event => { if (event.button !== 0) return; event.stopPropagation(); props.onTreeFocus?.(); chooseNode(node); if (node.kind === 'dir') toggleDirectory(node) }}>
          <text width={2} fg={selected ? theme.cyan : theme.dim} wrapMode="none">{selected ? '▎ ' : '  '}</text>
          <text fg={selected ? theme.text : color} wrapMode="none">{fitText(label, Math.max(1, width - 6))}</text>
        </box>
      })}
      {!files.length ? <text fg={theme.dim}>{props.scope === 'session' ? ' This session changed none of these files.' : ' No changed files available.'}</text> : null}
    </scrollbox>
    <box height={2} flexShrink={0} border={['top']} borderColor={theme.border} backgroundColor={theme.surface2}>
      <PaneResizeHandle kind="files" extent={listRows} edge="top" inset={-1} direction="bottom" limits={{ min: 1, max: Math.max(1, props.height - 22) }} />
      <text fg={theme.text} wrapMode="none">{selectedPath ? (() => {
        const position = hunks.length ? ` · hunk ${hunkIndex + 1}/${hunks.length}` : ''
        const status = ` ${selectedFile?.status.trim() ?? ''} `
        // The path gives way first: which hunk you are on is the part that changes as you review.
        return `${status}${fitText(selectedPath, Math.max(8, width - 2 - status.length - position.length)).trimEnd()}${position}`
      })() : ' Select a file to preview its diff'}</text>
    </box>
    {selectedPath ? <>
      {evidence.map(card => <Action key={card.key} theme={theme}
        label={fitText(card.role === 'user' ? `Request: ${card.compactSummary}` : `Edit source: ${card.label} · ${card.key.slice(-12)}`, width - 4)} onPress={() => props.onJump(card.key)} />)}
      {props.patch ? <StackDiffView id="engineering-diff-preview" model={model} theme={theme} height={diffRows} cursor={cursorRow}
        jumpKey={jumpRow ? diffRowKeys(jumpRow)[0] : undefined} jumpRevision={hunk.revision}
        onRowPress={index => { const at = stackDiffHunkAt(model, index); if (at >= 0) setHunk(previous => ({ path: selectedPath, index: at, revision: previous.revision })) }} />
        : <box id="engineering-diff-preview" height={diffRows} flexShrink={0}><text fg={theme.dim}> Loading diff…</text></box>}
      <box height={2} flexShrink={0} onMouseDown={event => { event.stopPropagation(); props.onBeginEdit() }}>
        <text fg={theme.dim} wrapMode="none">{fitText(hunks.length ? ` Comment hunk ${hunkIndex + 1} (c) · Enter adds to composer` : ' Comment (c) · Enter adds to composer', width - 2)}</text>
        <input id="engineering-input:comment" placeholder="Review comment…" value={comment}
          focused={props.focused && props.editing} onInput={setComment} onSubmit={submitComment} />
      </box>
    </> : <box flexGrow={1}><text fg={theme.dim}>{files.length ? ' Select a file or use ↑/↓ to preview.' : ' Changes appear here as files are edited.'}</text></box>}
  </box>
}
