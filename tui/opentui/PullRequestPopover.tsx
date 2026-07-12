/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../theme'
import { fetchPullRequestWorkspace, mutatePullRequest, type PullRequestWorkspace } from '../../lib/githubPr'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  cwd?: string | null
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
  onAskAgent: (prompt: string) => void
}

function questionPrompt(workspace: PullRequestWorkspace, question: string): string {
  const pr = workspace.selected
  if (!pr) return question
  const files = pr.files.map((file) => `${file.filename} (+${file.additions} -${file.deletions})`).join('\n')
  return `Review GitHub PR #${pr.number}: ${pr.title}\n${pr.url}\nBase: ${pr.baseRefName} <- ${pr.headRefName}\n\nChanged files:\n${files}\n\nQuestion: ${question}`
}

export function PullRequestPopover({ cwd, theme, width, height, onClose, onKeyHandlerReady, onAskAgent }: Props) {
  const repoCwd = cwd || process.cwd()
  const [workspace, setWorkspace] = useState<PullRequestWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [prIndex, setPrIndex] = useState(0)
  const [fileIndex, setFileIndex] = useState(0)
  const [mode, setMode] = useState<'browse' | 'comment' | 'request' | 'question'>('browse')
  const [draft, setDraft] = useState('')
  const editorRef = useRef<TextareaRenderable | null>(null)
  const diffRef = useRef<ScrollBoxRenderable>(null)

  const load = useCallback(async (number?: number) => {
    setLoading(true); setError(null)
    try { setWorkspace(await fetchPullRequestWorkspace(repoCwd, number)); setFileIndex(0); diffRef.current?.scrollTo(0) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [repoCwd])
  useEffect(() => { void load() }, [load])

  const pr = workspace?.selected ?? null
  const file = pr?.files[fileIndex] ?? null
  const discussion = useMemo(() => pr ? [
    ...pr.reviews.map((item) => `${item.author} [${item.state}] ${item.body || '(no message)'}`),
    ...pr.comments.map((item) => `${item.author}${item.path ? ` @ ${item.path}:${item.line ?? ''}` : ''}: ${item.body}`),
  ] : [], [pr])

  const submitComment = useCallback(async (verdict?: 'approve' | 'request-changes') => {
    if (!workspace?.repo || !pr) return
    const body = editorRef.current?.plainText ?? draft
    setLoading(true); setError(null)
    try {
      await mutatePullRequest(repoCwd, workspace.repo, verdict
        ? { action: 'review', number: pr.number, body, verdict }
        : { action: 'comment', number: pr.number, body })
      setDraft(''); setMode('browse'); await load(pr.number)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false) }
  }, [draft, load, pr, repoCwd, workspace?.repo])

  const handleKey = useCallback((key: Key) => {
    if (mode !== 'browse') {
      if (key.name === 'escape') { setMode('browse'); setDraft(''); return }
      return
    }
    if (key.name === 'escape' || key.name === 'q') { onClose(); return }
    if (key.name === 'j' || key.name === 'down') setFileIndex((index) => Math.min(index + 1, Math.max((pr?.files.length ?? 1) - 1, 0)))
    else if (key.name === 'k' || key.name === 'up') setFileIndex((index) => Math.max(index - 1, 0))
    else if (key.name === 'n' || key.name === 'right') {
      const next = Math.min(prIndex + 1, Math.max((workspace?.pullRequests.length ?? 1) - 1, 0)); setPrIndex(next)
      const number = workspace?.pullRequests[next]?.number; if (number) void load(number)
    } else if (key.name === 'p' || key.name === 'left') {
      const next = Math.max(prIndex - 1, 0); setPrIndex(next)
      const number = workspace?.pullRequests[next]?.number; if (number) void load(number)
    } else if (key.name === 'c') { setMode('comment'); setDraft('') }
    else if (key.name === '?') { setMode('question'); setDraft('') }
    else if (key.name === 'a') void submitComment('approve')
    else if (key.name === 'x') { setMode('request'); setDraft('') }
    else if (key.name === 'r') void load(pr?.number)
  }, [load, mode, onClose, pr?.files.length, pr?.number, prIndex, submitComment, workspace?.pullRequests])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  useEffect(() => { diffRef.current?.scrollTo(0) }, [fileIndex])

  const popupWidth = Math.max(Math.min(width - 4, 150), 72)
  const popupHeight = Math.max(Math.min(height - 2, 48), 20)
  const sideWidth = Math.max(Math.min(34, Math.floor(popupWidth * 0.26)), 24)
  const discussionWidth = Math.max(Math.min(38, Math.floor(popupWidth * 0.28)), 28)
  const diffWidth = popupWidth - sideWidth - discussionWidth - 4
  const bodyHeight = popupHeight - 5

  return <box position="absolute" top={1} left={Math.max(Math.floor((width - popupWidth) / 2), 0)} width={popupWidth} height={popupHeight} backgroundColor={theme.surface} border borderStyle="rounded" borderColor={theme.violet} title=" GitHub PR review " titleColor={theme.violet} zIndex={50} flexDirection="column">
    <box height={2} paddingX={1} flexDirection="column" backgroundColor={theme.surface2}>
      <text fg={theme.text} wrapMode="none">{pr ? `#${pr.number} ${pr.title}` : loading ? 'Loading pull requests...' : 'Pull requests'}</text>
      <text fg={theme.dim} wrapMode="none">{pr ? `${workspace?.repo}  ${pr.headRefName} -> ${pr.baseRefName}  +${pr.additions} -${pr.deletions}  ${pr.reviewDecision || 'review pending'}` : error || workspace?.error || repoCwd}</text>
    </box>
    <box height={bodyHeight} flexDirection="row">
      <box width={sideWidth} border borderStyle="single" borderColor={theme.border} flexDirection="column">
        <text fg={theme.cyan}> Files ({pr?.files.length ?? 0})</text>
        <scrollbox flexGrow={1}>
          {pr?.files.map((item, index) => <text key={item.filename} fg={index === fileIndex ? theme.text : theme.dim} bg={index === fileIndex ? theme.surface3 : undefined} wrapMode="none">{`${index === fileIndex ? '>' : ' '} ${item.filename} +${item.additions} -${item.deletions}`}</text>)}
        </scrollbox>
      </box>
      <box width={diffWidth} border borderStyle="single" borderColor={theme.border} flexDirection="column">
        <text fg={theme.cyan} wrapMode="none"> {file?.filename ?? 'Diff'}</text>
        <scrollbox ref={diffRef} flexGrow={1}>
          {(file?.patch || '(No textual patch available.)').split('\n').map((line, index) => <text key={index} fg={line.startsWith('+') && !line.startsWith('+++') ? theme.green : line.startsWith('-') && !line.startsWith('---') ? theme.red : line.startsWith('@@') ? theme.cyan : theme.text} wrapMode="none">{line || ' '}</text>)}
        </scrollbox>
      </box>
      <box width={discussionWidth} border borderStyle="single" borderColor={theme.border} flexDirection="column">
        <text fg={theme.cyan}> Discussion ({discussion.length})</text>
        <scrollbox flexGrow={1}>{discussion.map((line, index) => <text key={index} fg={theme.muted}>{line}\n</text>)}</scrollbox>
      </box>
    </box>
    {mode !== 'browse' ? <box position="absolute" left={Math.max(Math.floor(popupWidth * 0.18), 2)} top={Math.max(Math.floor(popupHeight * 0.25), 3)} width={Math.max(Math.floor(popupWidth * 0.64), 48)} height={10} border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface2} title={mode === 'question' ? ' Ask the active agent ' : mode === 'request' ? ' Request changes ' : ' PR comment '} flexDirection="column" paddingX={1} zIndex={52}>
      <textarea ref={editorRef} focused height={6} initialValue={draft} placeholder={mode === 'question' ? 'What should the agent inspect?' : 'Write a GitHub comment...'} onContentChange={() => setDraft(editorRef.current?.plainText ?? '')} onSubmit={() => {
        const text = editorRef.current?.plainText.trim() ?? ''
        if (!text) return
        if (mode === 'question' && workspace) { onAskAgent(questionPrompt(workspace, text)); setMode('browse'); onClose() }
        else void submitComment(mode === 'request' ? 'request-changes' : undefined)
      }} />
      <text fg={theme.dim}>Enter submit  Esc cancel</text>
    </box> : null}
    <box height={1} paddingX={1} backgroundColor={theme.surface2}><text fg={theme.dim} wrapMode="none">j/k file  n/p PR  c comment  a approve  x request changes  ? ask agent  r refresh  Esc close</text></box>
  </box>
}
