/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { TextareaRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule, type PluginWidgetModule } from '../../../lib/plugins/types'
import { proofFreshness, proofSummary, proofRunLabel, type ProofCheck } from '../../../lib/plugins/proof'
import { useProof } from '../../../lib/plugins/useProof'
import { proofKeyAction, type ProofKeyAction } from '../keys'
import { useProofView, type ProofViewState } from '../useProofView'
import { popoverRootProps, PopoverDetachButton, fitText, type TuiPluginView, type TuiPluginViewProps, type TuiPluginWidget, type TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'
const when = (enabled: boolean, action: () => unknown) => () => { if (enabled) void action() }

function useProofConfiguration(state: ProofViewState, cwd: string, scopedState: TuiPluginViewProps['useState']) {
  const [cursor, setCursor] = scopedState('cursor', 0), [editing, setEditing] = scopedState('editing', false), [draft, setDraft] = scopedState('config-draft', '')
  const [configError, setConfigError] = useState('')
  const [picking, setPicking] = useState(false), [picked, setPicked] = useState<string[]>([])
  const editor = useRef<TextareaRenderable>(null)
  const checks = state.snapshot?.config.checks ?? []
  const selected = checks[Math.min(cursor, Math.max(0, checks.length - 1))]
  const active = state.snapshot?.runs.find(run => !run.finishedAt)
  const suggestions = state.snapshot?.suggestions ?? []
  const chooseScripts = () => { setCursor(0); setPicked([]); setPicking(true) }
  const saveScripts = async () => {
    const added = suggestions.filter(check => picked.includes(check.id) && !checks.some(existing => existing.id === check.id))
    if (await state.configure([...checks, ...added])) setPicking(false)
  }
  const edit = () => { setConfigError(''); setDraft(JSON.stringify(checks, null, 2)); setEditing(true) }
  const save = async () => {
    try { const value = JSON.parse(editor.current?.plainText ?? draft) as ProofCheck[]; if (await state.configure(value)) setEditing(false) }
    catch (error) { setConfigError(error instanceof Error ? error.message : String(error)) }
  }
  return { cursor, setCursor, editing, setEditing, draft, setDraft, configError, picking, setPicking, picked, setPicked, editor, checks, selected, active, suggestions, chooseScripts, saveScripts, edit, save }
}

function useProofKeys(state: ProofViewState, config: ReturnType<typeof useProofConfiguration>, focused: boolean, registerKeys: TuiPluginViewProps['registerKeys'], close: () => void) {
  const { picking, editing, suggestions, checks, cursor, setCursor, setPicked, setEditing, setPicking, selected, active, saveScripts, save, chooseScripts, edit } = config
  useEffect(() => {
    const moveRun = (delta: number) => {
      const runs = state.snapshot?.runs ?? [], index = runs.findIndex(run => run.id === state.run?.id)
      const next = runs[Math.max(0, Math.min(runs.length - 1, index + delta))]
      if (next) { state.setRunId(next.id); state.setCheckId(null) }
    }
    const moveCheck = (delta: number) => {
      const results = state.run?.results ?? [], index = results.findIndex(result => result.check.id === state.result?.check.id)
      const next = results[Math.max(0, Math.min(results.length - 1, index + delta))]
      if (next) state.setCheckId(next.check.id)
    }
    const actions: Record<ProofKeyAction, () => void> = {
      save: when(!state.busy, picking ? saveScripts : save),
      discard: () => { setEditing(false); setPicking(false) },
      close,
      down: () => setCursor(value => Math.min((picking ? suggestions : checks).length - 1, value + 1)),
      up: () => setCursor(value => Math.max(0, value - 1)),
      toggle: () => {
        if (picking) { const candidate = suggestions[cursor]; if (candidate) setPicked(value => value.includes(candidate.id) ? value.filter(id => id !== candidate.id) : [...value, candidate.id]) }
        else if (selected) state.toggle(selected.id)
      },
      inspect: () => { if (selected) { state.setCheckId(selected.id); state.setAll(false) } },
      run: when(!state.busy && !active, state.start),
      cancel: when(!state.busy, state.cancel),
      scripts: when(!!state.snapshot && !state.busy, chooseScripts),
      edit: when(!!state.snapshot && !state.busy, edit),
      fix: state.prepare,
      expand: () => state.setAll(!state.all),
      refresh: () => { void state.refresh() },
      older: () => moveRun(1), newer: () => moveRun(-1),
      next: () => moveCheck(1), previous: () => moveCheck(-1),
    }
    registerKeys(key => {
      if (!focused) return false
      const action = proofKeyAction(key, picking ? 'picker' : editing ? 'editor' : 'normal')
      if (!action) return false
      actions[action](); return true
    })
    return () => registerKeys(null)
  })
}

function Proof({ services, theme, width, height, placement, registerKeys, close, detach, focused, setCapture, useState: scopedState }: TuiPluginViewProps) {
  const cwd = services.repository!.cwd, session = services.session?.session
  const origin = session?.provider ? { provider: session.provider, providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } : undefined
  const state = useProofView(services.proof!, cwd, origin, services.composer?.insertText, scopedState)
  const config = useProofConfiguration(state, cwd, scopedState)
  const { cursor, setCursor, editing, configError, picking, checks } = config
  const overlay = placement === 'overlay'
  useEffect(() => { setCapture(editing && focused ? 'input' : false); return () => setCapture(false) }, [editing, focused, setCapture])
  useProofKeys(state, config, focused, registerKeys, close)
  const w = overlay ? Math.max(1, Math.min(width - 4, 100)) : width, h = overlay ? Math.max(1, height - 4) : height
  const textWidth = Math.max(1, w - (overlay ? 4 : 2))
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, 50)}
    border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" paddingX={1} title={overlay ? ' Proof ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <ProofHeader state={state} cwd={cwd} theme={theme} textWidth={textWidth} configError={configError} />
    {picking ? <ScriptPicker config={config} focused={focused} theme={theme} textWidth={textWidth} /> : editing ? <ConfigurationEditor config={config} focused={focused} cwd={cwd} /> : <Evidence state={state} checks={checks} cursor={cursor} setCursor={setCursor} theme={theme} textWidth={textWidth} />}
  </box>
}



function ProofHeader({ state, cwd, theme, textWidth, configError }: { state: ProofViewState; cwd: string; theme: TuiPluginViewProps['theme']; textWidth: number; configError: string }) {
  return <>
    <text fg={theme.text} wrapMode="none">{fitText(`Proof · ${state.snapshot ? proofSummary(state.snapshot) : 'loading'} · ${cwd}`, textWidth)}</text>
    <text fg={theme.dim} wrapMode="none">{fitText('s scripts · e configure · Space select · r run · c cancel · g refresh · Esc close', textWidth)}</text>
    {configError ? <text fg={theme.red}>{configError}</text> : null}
    {state.error || state.notice ? <text fg={state.error ? theme.red : theme.amber} wrapMode="word">{state.error ?? state.notice}</text> : null}
  </>
}

function ScriptPicker({ config, focused, theme, textWidth }: { config: ReturnType<typeof useProofConfiguration>; focused: boolean; theme: TuiPluginViewProps['theme']; textWidth: number }) {
  const { suggestions, cursor, setCursor, picked, setPicked } = config
  return <scrollbox flexGrow={1}>
      <text fg={theme.dim}>Choose scripts · Space select · Enter save · Esc discard</text>
      {!suggestions.length ? <text fg={theme.dim}>No package scripts found. Press Esc, then e to define a command.</text> : null}
      {suggestions.map((check, index) => <text key={check.id} fg={index === cursor ? theme.cyan : theme.text} onMouseDown={() => { if (focused) { setCursor(index); setPicked(value => value.includes(check.id) ? value.filter(id => id !== check.id) : [...value, check.id]) } }}>{fitText(`${index === cursor ? '›' : ' '} [${picked.includes(check.id) ? 'x' : ' '}] ${check.label}`, textWidth)}</text>)}
    </scrollbox>
}

function ConfigurationEditor({ config, focused, cwd }: { config: ReturnType<typeof useProofConfiguration>; focused: boolean; cwd: string }) {
  const { draft, setDraft, editor } = config
  return <box flexDirection="column" flexGrow={1} minHeight={3}>
      <text >Check definitions (JSON array) · Ctrl+S save · Esc discard</text>
      <text >id, label, executable, args[], cwd, timeoutMs</text>
      <textarea key={cwd} initialValue={draft} focused={focused} ref={editor} width="100%" flexGrow={1} onContentChange={() => setDraft(editor.current?.plainText ?? '')} />
    </box>
}

function Evidence({ state, checks, cursor, setCursor, theme, textWidth }: { state: ProofViewState; checks: ProofCheck[]; cursor: number; setCursor: (value: number) => void; theme: TuiPluginViewProps['theme']; textWidth: number }) {
  return <scrollbox flexGrow={1} minHeight={1} width="100%">
      {!checks.length ? <text fg={theme.dim}>No checks configured. Press s for package scripts or e to add commands.</text> : null}
      {checks.map((check, index) => <text key={check.id} fg={index === cursor ? theme.cyan : theme.text} wrapMode="none" onMouseDown={() => { setCursor(index); state.toggle(check.id) }}>{fitText(`${index === cursor ? '›' : ' '} [${state.selected.includes(check.id) ? 'x' : ' '}] ${check.label}`, textWidth)}</text>)}
      <text fg={theme.dim}>Receipts cover Git-visible source; browser/provider checks remain separate.</text>
      {state.snapshot?.fingerprintError ? <text fg={theme.amber}>Freshness unknown: {state.snapshot.fingerprintError}</text> : null}
      {state.run ? <text fg={theme.dim}>{fitText(`Run ${proofRunLabel(state.run)} · [ ] history`, textWidth)}</text> : null}
      {state.run?.results.map(result => <text key={result.check.id} fg={result.status === 'passed' && state.snapshot && proofFreshness(result, state.snapshot) === 'current' ? theme.green : result.status === 'failed' ? theme.red : theme.amber} wrapMode="none" onMouseDown={() => state.setCheckId(result.check.id)}>{fitText(`${state.result === result ? '›' : ' '} ${result.check.label} · ${result.status} · ${state.snapshot ? proofFreshness(result, state.snapshot) : 'unknown'}`, textWidth)}</text>)}
      {state.result?.error ? <text fg={theme.red} wrapMode="word">{state.result.error}</text> : null}
      <text fg={theme.dim}>n/p inspect check · a Show all/Show less · f Prepare fix prompt</text>
      {(state.all ? state.output : state.output.split('\n').slice(0, 12).join('\n')).split('\n').map((line, index) => <text key={index} fg={theme.text} wrapMode="word">{line || ' '}</text>)}
      {state.result?.truncated ? <text fg={theme.amber}>Output truncated at 1 MiB.</text> : null}
    </scrollbox>
}

function Status({ services, theme, width }: TuiPluginWidgetProps) {
  const { snapshot, error } = useProof(services?.proof, services?.repository?.cwd ?? null)
  if (!snapshot || (!snapshot.config.checks.length && !snapshot.runs.length)) return null
  const status = error ? 'freshness unavailable' : proofSummary(snapshot)
  return <box height={1} width={width} backgroundColor={theme.surface}><text fg={status === 'passed' ? theme.green : status === 'failed' ? theme.red : theme.amber} wrapMode="none">{fitText(`Proof · ${status}`, width)}</text></box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'proof', views: { proof: Proof } }
export const widgets: PluginWidgetModule<TuiPluginWidget> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'proof', widgets: { status: Status } }
