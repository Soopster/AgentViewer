/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import type { TuiTranscriptCard } from '../../format'
import { fitText } from '../textLayout'
import { EngineeringAction as Action } from './EngineeringAction'
import type { EngineeringFile } from './repository'

type Props = {
  files: EngineeringFile[]; width: number; height: number; theme: TuiThemePalette
  selectedPath: string | null; patch: string; evidence: TuiTranscriptCard[]
  focused: boolean; editing: boolean
  onSelect: (path: string, index: number) => void
  onReview: () => void; onJump: (key: string) => void
  onBeginEdit: () => void; onEndEdit: () => void; onAppend: (text: string) => void
}

function patchColor(line: string, theme: TuiThemePalette) {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return theme.cyan
  if (line.startsWith('+')) return theme.green
  if (line.startsWith('-')) return theme.red
  return theme.text
}

export function EngineeringChanges(props: Props) {
  const { files, theme, width, selectedPath } = props
  const [comment, setComment] = useState('')
  const list = useRef<ScrollBoxRenderable | null>(null)
  const listRows = Math.max(4, Math.min(14, Math.floor(props.height * .3)))
  useEffect(() => {
    const index = files.findIndex(file => file.path === selectedPath)
    const scroll = list.current
    if (!scroll || index < 0) return
    if (index < scroll.scrollTop) scroll.scrollTo(index)
    else if (index >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(Math.max(0, index - scroll.viewport.height + 1))
  }, [selectedPath, files])

  return <box flexGrow={1} minHeight={0} flexDirection="column">
    <box height={1} flexShrink={0}><text fg={theme.dim}> Repository-wide · {files.length} changed files</text></box>
    <Action theme={theme} label="Open full Git review / hunk comments" onPress={props.onReview} />
    <scrollbox ref={list} height={listRows} flexShrink={0}>
      {files.map((file, index) => {
        const stats = file.status === '??' ? 'new' : file.additions === 'binary' ? 'binary' : `+${file.additions} −${file.deletions}`
        const label = `${file.status} ${fitText(file.path, Math.max(8, width - stats.length - 8))} ${stats}`
        return <Action key={file.path} theme={theme} tone={theme.text} selected={selectedPath === file.path}
          label={label} onPress={() => props.onSelect(file.path, index)} />
      })}
      {!files.length ? <text fg={theme.dim}> No changed files available.</text> : null}
    </scrollbox>
    <box height={1} flexShrink={0} backgroundColor={theme.surface2}>
      <text fg={theme.text} wrapMode="none">{fitText(` ${selectedPath ?? 'Select a file to preview its diff'}`, width - 2)}</text>
    </box>
    {selectedPath ? <>
      <box height={1} flexShrink={0}><text fg={theme.dim} wrapMode="none"> Current hunk ownership: unattributed</text></box>
      {props.evidence.slice(-2).map(card => <Action key={card.key} theme={theme}
        label={fitText(`Edit source: ${card.label} · ${card.key.slice(-12)}`, width - 4)} onPress={() => props.onJump(card.key)} />)}
      <scrollbox id="engineering-diff-preview" flexGrow={1} minHeight={0}>
        <text>{(props.patch || 'Loading diff…').split('\n').map((line, index) => <span key={index} fg={patchColor(line, theme)}>{`${line}\n`}</span>)}</text>
      </scrollbox>
      <box height={2} flexShrink={0} onMouseDown={event => { event.stopPropagation(); props.onBeginEdit() }}>
        <text fg={theme.dim} wrapMode="none"> Comment · Enter adds to composer</text>
        <input id="engineering-input:comment" placeholder="Review comment…" value={comment}
          focused={props.focused && props.editing} onInput={setComment} onSubmit={() => {
            if (!comment.trim()) return
            props.onAppend(`Review ${selectedPath}: ${comment}`)
            setComment(''); props.onEndEdit()
          }} />
      </box>
    </> : <box flexGrow={1}><text fg={theme.dim}> Select a file or use ↑/↓ to preview.</text></box>}
  </box>
}
