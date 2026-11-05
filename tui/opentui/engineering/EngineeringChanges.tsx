/** @jsxImportSource @opentui/react */
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import { buildSelectionAskPrompt } from '../../../lib/selectionAsk'
import { fitText } from '../textLayout'
import { EngineeringAction as Action } from './EngineeringAction'
import { PaneResizeHandle } from '../paneResize'
import type { EngineeringFile } from './repository'
import { diffAppearance, diffRowKeys, stackDiffHunkAt, stackDiffHunks, StackDiffView, useStackDiffModel } from '../diff'
import { nearestDiffContextGap } from '../gitDiffContext'

/** What the inspector's key handler asks of the diff it does not own. */
export type EngineeringChangesHandle = {
  /** Step the hunk cursor; false when the file has no hunks. */
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
  /** Repository the diff came from; omitted context is read from it. */
  root?: string
  wrap?: boolean
  /** Repository-relative paths this session edited, marked ● in the list. */
  sessionFiles?: ReadonlySet<string>
  /** Changes shown when the list is narrowed to this session's files. */
  totalFiles?: number
  scope?: 'all' | 'session'
  onToggleScope?: () => void
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
  const [comment, setComment] = useState('')
  const [hunk, setHunk] = useState<{ path: string | null; index: number; revision: number }>({ path: null, index: 0, revision: 0 })
  const list = useRef<ScrollBoxRenderable | null>(null)
  const selectedFile = files.find(file => file.path === selectedPath)
  const model = useStackDiffModel({
    diffText: props.patch, documentKey: `engineering:${props.root ?? ''}:${selectedPath ?? ''}`, cwd: props.root ?? process.cwd(),
    width: width - 2, appearance: diffAppearance(theme), wrap: props.wrap ?? true, hideFileRows: true,
  })
  const hunks = useMemo(() => stackDiffHunks(model), [model.rows, model.hunkRows])
  const hunkIndex = hunk.path === selectedPath ? Math.min(hunk.index, Math.max(0, hunks.length - 1)) : 0
  const cursorRow = hunks[hunkIndex]?.row ?? null
  useImperativeHandle(props.handleRef, () => ({
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
  }), [hunks, hunkIndex, selectedPath, cursorRow, model])

  const listRows = Math.max(1, Math.min(props.listRowsPreference ?? Math.min(Math.max(files.length, 1), 14, Math.floor(props.height * .3)), Math.max(1, props.height - 22)))
  const evidence = props.evidence.slice(-2)
  // summary, review action, list, selected-file row (2), evidence, comment (2)
  const diffRows = Math.max(3, props.height - INSPECTOR_CHROME_ROWS - (2 + listRows + 2 + evidence.length + 2))
  useEffect(() => {
    const index = files.findIndex(file => file.path === selectedPath)
    const scroll = list.current
    if (!scroll || index < 0) return
    if (index < scroll.scrollTop) scroll.scrollTo(index)
    else if (index >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(Math.max(0, index - scroll.viewport.height + 1))
  }, [selectedPath, files])

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
    <scrollbox ref={list} height={listRows} flexShrink={0}>
      {files.map((file, index) => {
        const stats = file.status === '??' ? 'new' : file.additions === 'binary' ? 'binary' : `+${file.additions} −${file.deletions}`
        const mine = props.sessionFiles?.has(file.path) ? '●' : ' '
        const label = `${mine}${file.status} ${fitText(file.path, Math.max(8, width - stats.length - 9))} ${stats}`
        return <Action key={file.path} theme={theme} tone={theme.text} selected={selectedPath === file.path}
          label={label} onPress={() => props.onSelect(file.path, index)} />
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
        label={fitText(`Edit source: ${card.label} · ${card.key.slice(-12)}`, width - 4)} onPress={() => props.onJump(card.key)} />)}
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
