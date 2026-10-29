/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TextareaRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import type { GitKeyEvent } from './GitPopover'
import { localWorkspaceTransport } from '../../../lib/git/workspaceService'
import { chooseConflictBlock, conflictBlocks } from '../../../lib/git/conflictText'
import type { ConflictPreview, WorkflowDraft } from '../../../lib/git/workspaceTypes'

export function GitConflictEditor({ focused = true, cwd, path, theme, width, height, busy, error, onRun, onClose, onKeyHandlerReady }: {
  focused?: boolean; cwd: string; path: string; theme: TuiThemePalette; width: number; height: number; busy: boolean; error: string | null
  onRun: (action: WorkflowDraft, revision: string) => Promise<boolean>; onClose: () => void; onKeyHandlerReady: (handler: (key: GitKeyEvent) => boolean | void) => void
}) {
  const [conflict, setConflict] = useState<ConflictPreview | null>(null), [content, setContent] = useState(''), [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState<'base' | 'ours' | 'theirs'>('ours'), [editing, setEditing] = useState(false), [pending, setPending] = useState<WorkflowDraft | null>(null)
  const [offset, setOffset] = useState(0), [editVersion, setEditVersion] = useState(0)
  const editor = useRef<TextareaRenderable | null>(null)
  const blocks = useMemo(() => conflictBlocks(content), [content])
  const lines = useMemo(() => (conflict?.[version]?.content ?? '(binary content or absent file)').split('\n'), [conflict, version])
  const w = Math.max(16, width - 4), h = Math.max(8, height - 4)
  useEffect(() => {
    let live = true
    void localWorkspaceTransport.conflict(cwd, path).then(value => { if (live) { setConflict(value); setContent(value.working ?? '') } }).catch(error => { if (live) setLoadError(String(error)) })
    return () => { live = false }
  }, [cwd, path])
  const submit = useCallback(async () => { if (pending && conflict && await onRun(pending, conflict.revision)) onClose() }, [pending, conflict, onRun, onClose])
  const handleKey = useCallback((key: GitKeyEvent) => {
    if (busy) return
    if (key.name === 'escape') { if (pending) setPending(null); else if (editing) setEditing(false); else onClose(); return }
    if (pending) { if (key.name === 'return') void submit(); return }
    if (!conflict) return
    if (editing) {
      if (key.ctrl && (key.name === 'return' || key.name === 's')) { if (blocks.length === 0) setPending({ kind: 'conflict-save', path, content }); return }
      if (key.ctrl && ['o', 't', 'y'].includes(key.name)) { setContent(value => chooseConflictBlock(value, 0, key.name === 'o' ? 'ours' : key.name === 't' ? 'theirs' : 'both')); setEditVersion(value => value + 1); return }
      return false
    }
    if (key.sequence === 'b' || key.sequence === 'o' || key.sequence === 't') { setVersion(key.sequence === 'b' ? 'base' : key.sequence === 'o' ? 'ours' : 'theirs'); setOffset(0); return }
    if (key.sequence === 'e' && conflict.editable) { setEditing(true); return }
    if (key.sequence === 'O' || key.sequence === 'T' || key.sequence === 'w') { setPending({ kind: 'resolve', path, choice: key.sequence === 'O' ? 'ours' : key.sequence === 'T' ? 'theirs' : 'working' }); return }
    const delta = key.name === 'down' || key.sequence === 'j' ? 1 : key.name === 'up' || key.sequence === 'k' ? -1 : 0
    if (delta) setOffset(value => Math.max(0, Math.min(lines.length - 1, value + delta)))
  }, [busy, pending, editing, onClose, submit, conflict, blocks.length, path, content, lines.length])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  return <box position="absolute" left={1} top={1} width={w} height={h} zIndex={5} border borderColor={theme.cyan} backgroundColor={theme.surface} paddingX={1} flexDirection="column" title=" Resolve conflict ">
    <text fg={theme.cyan} wrapMode="none">{path}</text>
    <text fg={theme.dim} wrapMode="none">During rebase: ours = onto branch · theirs = replayed commit</text>
    <box flexGrow={1} minHeight={1} flexDirection="column" overflow="hidden">
      {!conflict ? <text fg={theme.dim}>Loading conflict versions…</text> : pending ? <><text fg={theme.amber} wrapMode="word">{pending.kind === 'conflict-save' ? 'Save the edited result and stage it as resolved?' : `Replace/stage ${pending.kind === 'resolve' ? pending.choice : ''} for this file? A missing version deletes it.`}</text><text fg={theme.text} wrapMode="word">{path}</text></> : editing ? <>
        <text fg={theme.cyan}>{`${blocks.length} conflict blocks remain · Ctrl+O ours · Ctrl+T theirs · Ctrl+Y both (first block)`}</text>
        <textarea key={editVersion} ref={editor} id="git-conflict-result" initialValue={content} focused={focused && !busy} width="100%" flexGrow={1} onContentChange={() => setContent(editor.current?.plainText ?? '')} />
      </> : <>
        <text fg={theme.cyan}>{`${version} · b/o/t versions · e edit result`}</text>
        {lines.slice(offset, offset + Math.max(1, h - 9)).map((line, index) => <text key={offset + index} fg={theme.text} wrapMode="none">{line || ' '}</text>)}
      </>}
    </box>
    {loadError || error ? <box height={2} flexShrink={0}><text fg={theme.red} wrapMode="word">{loadError ?? error}</text></box> : null}
    <box height={1} flexShrink={0} onMouseDown={() => { if (!busy && pending) void submit() }}><text fg={theme.amber} wrapMode="none">{busy ? 'Git operation running…' : pending ? 'Enter confirms resolution · Esc edits' : editing ? 'Ctrl+Enter saves/stages after all blocks resolved · Esc back' : 'O use ours file · T use theirs file · w mark working resolved · Esc closes'}</text></box>
  </box>
}
