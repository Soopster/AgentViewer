/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { GitKeyEvent, GitPopoverProps } from './GitPopover'
import { browseChangedFiles, type BrowseCommit, type BrowseChangedFile } from '../../../lib/git/browse'

const display = (value: string) => value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ')
export function CommitDetails({ cwd, commit, theme, onParent, onFile, registerKeys, height }: {
  cwd: string; commit: BrowseCommit | null; theme: GitPopoverProps['theme']; height: number
  onParent: (sha: string) => void; onFile: (path: string) => void; registerKeys: GitPopoverProps['onKeyHandlerReady']
}) {
  const [files, setFiles] = useState<BrowseChangedFile[]>([])
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState(0)
  const scroll = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    let live = true
    setFiles([]); setError(''); setCursor(0); scroll.current?.scrollTo(0)
    if (commit) void browseChangedFiles(cwd, commit).then(next => { if (live) setFiles(next) }).catch(e => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [cwd, commit])
  const parents = commit?.parents.length ?? 0
  const select = useCallback((index: number) => {
    if (index < parents) { const sha = commit?.parents[index]; if (sha) onParent(sha) }
    else { const file = files[index - parents]; if (file) onFile(file.path) }
  }, [parents, commit, onParent, files, onFile])
  const handle = useCallback((key: GitKeyEvent) => {
    if (key.name === 'escape' || key.name === 'tab') return false
    if (key.name === 'return') { select(cursor); return }
    const delta = key.name === 'down' || key.sequence === 'j' ? 1 : key.name === 'up' || key.sequence === 'k' ? -1 : 0
    if (delta) { setCursor(old => Math.max(0, Math.min(parents + files.length - 1, old + delta))); scroll.current?.scrollBy(delta); return }
    if (key.name === 'pagedown' || key.name === 'pageup') scroll.current?.scrollBy(key.name === 'pagedown' ? height - 2 : 2 - height)
  }, [cursor, select, parents, files.length, height])
  useEffect(() => registerKeys(handle), [registerKeys, handle])
  return <scrollbox ref={scroll} flexGrow={1} scrollY>
    {commit ? <>
      <text fg={theme.text}>{display(`Author     ${commit.author} <${commit.email}>\nAuthored   ${commit.date}\nCommitter  ${commit.committer}\nCommitted  ${commit.committed}\nSHA        ${commit.sha}\nRefs       ${commit.refs || '(none)'}`)}</text>
      <text fg={theme.muted}>{parents ? 'Parents (Enter to inspect)' : 'Root commit'}</text>
      {commit.parents.map((sha, index) => <box key={sha} height={1} flexShrink={0} backgroundColor={cursor === index ? theme.surface3 : undefined} onMouseDown={() => { setCursor(index); onParent(sha) }}><text fg={theme.cyan}>{sha}</text></box>)}
      <text fg={theme.text}>{`\n${display(commit.message)}\n`}</text>
      <text fg={theme.muted}>{error || `Changed files (${files.length}) · Enter opens Changes`}</text>
      {files.map((file, index) => <box key={file.path} height={1} flexShrink={0} backgroundColor={cursor === parents + index ? theme.surface3 : undefined} onMouseDown={() => { setCursor(parents + index); onFile(file.path) }}><text fg={theme.cyan} wrapMode="none">{display(`${file.status} ${file.path}${file.previousPath ? ` ← ${file.previousPath}` : ''}`)}</text></box>)}
    </> : <text fg={theme.dim}>Select a commit.</text>}
  </scrollbox>
}
