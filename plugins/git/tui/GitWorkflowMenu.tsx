/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import type { GitKeyEvent } from './GitPopover'
import { initialWorkflowValues, workflowPaths, workflowChoices, workflowSummary, type WorkflowChoice, type WorkflowContext } from '../../../lib/git/workflowMenu'
import type { WorkflowDraft, WorkspaceSnapshot } from '../../../lib/git/workspaceTypes'

export function GitWorkflowMenu({ focused = true, snapshot, context, path, theme, width, height, busy, error, onRun, onClose, onKeyHandlerReady }: {
  focused?: boolean; snapshot: WorkspaceSnapshot; context: WorkflowContext; path: string | null; theme: TuiThemePalette; width: number; height: number
  busy: boolean; error: string | null; onRun: (action: WorkflowDraft, revision: string) => Promise<boolean>; onClose: () => void; onKeyHandlerReady: (handler: (key: GitKeyEvent) => boolean | void) => void
}) {
  const choices = useMemo(() => workflowChoices(snapshot, context, path), [snapshot, context, path])
  const [cursor, setCursor] = useState(0), [fieldIndex, setFieldIndex] = useState(0), [optionCursor, setOptionCursor] = useState(0)
  const [selected, setSelected] = useState<WorkflowChoice | null>(null), [values, setValues] = useState<Record<string, string>>({})
  const [review, setReview] = useState<string | null>(null), [localError, setLocalError] = useState<string | null>(null)
  const w = Math.max(16, Math.min(width - 4, 92)), h = Math.max(8, Math.min(height - 4, 27))
  const field = selected?.fields[fieldIndex]
  const change = useCallback((key: string, value: string) => setValues(previous => ({ ...previous, [key]: value })), [])
  const choose = useCallback((item: WorkflowChoice) => { setSelected(item); setValues(initialWorkflowValues(item)); setFieldIndex(0); setOptionCursor(0); setLocalError(null); if (item.fields.length === 0) setReview(workflowSummary(item, {})) }, [])
  const prepare = useCallback(() => { if (selected) try { setReview(workflowSummary(selected, values)); setLocalError(null) } catch (error) { setLocalError(String(error instanceof Error ? error.message : error)) } }, [selected, values])
  const submit = useCallback(async () => {
    if (!selected) return
    try { if (await onRun(selected.build(values), snapshot.workflowRevision)) onClose() } catch (error) { setLocalError(String(error instanceof Error ? error.message : error)) }
  }, [selected, values, onRun, snapshot.workflowRevision, onClose])
  const handleKey = useCallback((key: GitKeyEvent) => {
    if (busy) return
    if (key.name === 'escape') { if (review) setReview(null); else if (selected) setSelected(null); else onClose(); return }
    if (review) { if (key.name === 'return') void submit(); return }
    if (!selected) {
      if (key.name === 'down' || key.sequence === 'j') setCursor(value => Math.min(choices.length - 1, value + 1))
      else if (key.name === 'up' || key.sequence === 'k') setCursor(value => Math.max(0, value - 1))
      else if (key.name === 'return' && choices[cursor]) choose(choices[cursor]!)
      return
    }
    if (key.ctrl && (key.name === 'return' || key.name === 's')) { prepare(); return }
    if (key.name === 'tab' || key.name === 'return') {
      if (fieldIndex === selected.fields.length && key.name === 'return') prepare()
      else { setFieldIndex(value => (value + (key.shift ? selected.fields.length : 1)) % (selected.fields.length + 1)); setOptionCursor(0) }
      return
    }
    if (!field) return
    if (field.kind === 'text') return false
    const delta = key.name === 'down' || key.name === 'right' ? 1 : key.name === 'up' || key.name === 'left' ? -1 : 0
    if (field.kind === 'choice' && delta && field.options?.length) {
      const index = field.options.findIndex(option => option.value === values[field.key])
      change(field.key, field.options[(index + delta + field.options.length) % field.options.length]!.value)
    }
    if (field.kind === 'toggle' && (key.sequence === ' ' || delta)) change(field.key, values[field.key] === 'true' ? 'false' : 'true')
    if (field.kind === 'paths') {
      if (delta) setOptionCursor(value => Math.max(0, Math.min((field.options?.length ?? 1) - 1, value + delta)))
      if (key.sequence === ' ') {
        const option = field.options?.[optionCursor], paths = workflowPaths(values[field.key] || '[]')
        if (option) change(field.key, JSON.stringify(paths.includes(option.value) ? paths.filter(path => path !== option.value) : [...paths, option.value]))
      }
    }
  }, [busy, review, selected, onClose, submit, choices, cursor, choose, prepare, fieldIndex, field, values, change, optionCursor])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  const start = Math.max(0, cursor - Math.floor((h - 7) / 2))
  return <box position="absolute" left={Math.max(0, Math.floor((width - w) / 2))} top={Math.max(0, Math.floor((height - h) / 2))} width={w} height={h} zIndex={5} border borderColor={theme.cyan} backgroundColor={theme.surface} flexDirection="column" paddingX={1} title=" Git actions ">
    <text fg={theme.cyan} wrapMode="none">{selected?.label ?? `${snapshot.branch} · choose an action`}</text>
    <box flexGrow={1} minHeight={1} flexDirection="column" overflow="hidden">
      {!selected ? choices.slice(start, start + h - 7).map((item, index) => <box key={item.id} height={1} flexShrink={0} backgroundColor={cursor === start + index ? theme.surface3 : undefined} onMouseDown={() => { if (!busy) choose(item) }}><text fg={cursor === start + index ? theme.cyan : theme.text} wrapMode="none">{cursor === start + index ? '▶ ' : '  '}{item.label}</text></box>) : review ? <scrollbox flexGrow={1} scrollY><text fg={theme.text} wrapMode="word">{`${snapshot.root}\nBranch: ${snapshot.branch}\nHEAD: ${snapshot.head?.slice(0, 12) ?? '(unborn)'}\n${snapshot.files.length} changed files\n\n${review}`}</text></scrollbox> : <>
        <text fg={theme.dim} wrapMode={h < 18 ? "none" : "word"}>{selected.description}</text>
        <box height={1} flexShrink={0} />
        {selected.fields.map((item, index) => h < 18 && index !== fieldIndex ? null : <box key={item.key} height={item.kind === 'text' ? 2 : 1} flexShrink={0} flexDirection="column" onMouseDown={() => { if (!busy) { setFieldIndex(index); setOptionCursor(0) } }}>
          <text fg={fieldIndex === index ? theme.cyan : theme.muted} wrapMode="none">{`${fieldIndex === index ? '▶ ' : '  '}${item.label}${item.kind === 'text' ? '' : ': ' + (item.kind === 'paths' ? `${workflowPaths(values[item.key] || '[]').length} selected` : values[item.key])}`}</text>
          {item.kind === 'text' ? <input id={`git-workflow-${item.key}`} value={values[item.key] ?? ''} focused={focused && !busy && fieldIndex === index} onInput={value => change(item.key, value)} /> : null}
        </box>)}
        {field?.kind === 'paths' ? <box height={2} flexShrink={0}><text fg={theme.cyan} wrapMode="word">{`↑/↓ choose · space toggles: ${field.options?.[optionCursor]?.label ?? '(no files)'}`}</text></box> : null}
        <box height={1} onMouseDown={() => { if (!busy) prepare() }}><text fg={fieldIndex === selected.fields.length ? theme.cyan : theme.muted}>[Review action]</text></box>
      </>}
    </box>
    {error || localError ? <box height={2} flexShrink={0}><text fg={theme.red} wrapMode="word">{localError ?? error}</text></box> : null}
    <box height={1} flexShrink={0} onMouseDown={() => { if (!busy) { if (review) void submit(); else if (selected) prepare() } }}><text fg={theme.amber} wrapMode="none">{busy ? 'Git operation running…' : review ? 'Enter confirms · Esc edits' : selected ? 'Tab next field · arrows choose · Ctrl+Enter reviews · Esc back' : '↑/↓ select · Enter opens · Esc closes'}</text></box>
  </box>
}
