/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { WORKFLOW_PACKS } from '../../../lib/plugins/workflowPacks'
import { popoverRootProps, PopoverDetachButton, fitText, ShortcutHelp, type ShortcutHelpGroup, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { useWorkflowPacks } from '../useWorkflowPacks'
const TABS = ['Overview', 'Stages', 'Install', 'Definition'] as const
type Tab = typeof TABS[number]
const HELP: readonly ShortcutHelpGroup[] = [
  { title: 'Navigate', rows: [['1 / 2', 'Pack list / details'], ['Tab / Shift+Tab', 'Switch pane focus'], ['← / →', 'Switch detail tabs'], ['j/k or ↑/↓', 'Choose pack, choose stage, or scroll'], ['PgUp / PgDn', 'Scroll details, including stage tasks'], ['Enter', 'Open selected pack'], ['Ctrl+N', 'Toggle pack list'], ['f', 'Toggle full JSON definition']] },
  { title: 'Import and install', rows: [['e', 'Edit imported pack JSON'], ['Ctrl+S / Esc', 'Leave editor; retain imported JSON'], ['p', 'Preview installation in this repository'], ['i', 'Install missing workflows from preview']] },
]
function WorkflowPacks(props: TuiPluginViewProps) {
  const { services, theme, width, height, focused, placement, detach, registerKeys, setCapture, useState: scoped } = props
  const state = useWorkflowPacks(services.playbooks!, services.repository!.cwd, scoped)
  const [editing, setEditing] = scoped('editing', false), [tab, setTab] = scoped<Tab>('tab', 'Overview')
  const [region, setRegion] = scoped<'packs' | 'detail'>('region', 'packs'), [sidebar, setSidebar] = scoped('sidebar', true)
  const [stageCursor, setStageCursor] = scoped('stage', 0), [help, setHelp] = useState(false)
  const editor = useRef<TextareaRenderable>(null), list = useRef<ScrollBoxRenderable>(null), selectedRow = useRef<BoxRenderable>(null)
  const content = useRef<ScrollBoxRenderable>(null), stagesList = useRef<ScrollBoxRenderable>(null), selectedStageRow = useRef<BoxRenderable>(null), helpScroll = useRef<ScrollBoxRenderable>(null)
  const overlay = placement === 'overlay', w = overlay ? Math.max(1, Math.min(width - 4, 150)) : width, h = overlay ? Math.max(1, height - 4) : height
  const inner = Math.max(1, w - 2), narrow = w < 80, showList = narrow ? region === 'packs' && !editing : sidebar
  const showDetail = !narrow || region === 'detail' || editing, listWidth = narrow ? inner : Math.min(36, Math.floor(inner * .29)), detailWidth = Math.max(1, inner - (showList ? listWidth : 0))
  const ids = [...WORKFLOW_PACKS.map(pack => pack.id), 'import']
  const phases = state.pack?.playbooks.flatMap(playbook => playbook.phases.map((phase, index) => ({ phase, playbook: playbook.name, index }))) ?? []
  const stage = Math.max(0, Math.min(stageCursor, phases.length - 1)), selectedStage = phases[stage]
  const missing = state.rows?.filter(row => row.status === 'missing').length ?? 0
  const choose = (id: string, open = true) => { state.setSelected(id); setStageCursor(0); setTab('Overview'); if (narrow && open) setRegion('detail') }
  const changeTab = (next: Tab) => { setTab(next); setRegion('detail') }
  const preview = () => { void state.preview().then(() => changeTab('Install')) }
  const importJson = () => { state.setSelected('import'); setRegion('detail'); setEditing(true) }
  const toggleSidebar = () => { if (narrow) setRegion(region === 'packs' ? 'detail' : 'packs'); else { setSidebar(!sidebar); if (sidebar) setRegion('detail') } }
  useEffect(() => { setCapture(focused ? editing ? 'input' : help : false); return () => setCapture(false) }, [editing, help, focused, setCapture])
  useEffect(() => { if (selectedRow.current) list.current?.scrollChildIntoView(selectedRow.current) }, [state.selected, showList])
  useEffect(() => { if (selectedStageRow.current) stagesList.current?.scrollChildIntoView(selectedStageRow.current); content.current?.scrollTo(0) }, [stage, tab, state.selected])
  useEffect(() => {
    registerKeys(key => {
      if (!focused) return false
      if (help) {
        if (key.name === 'escape' || key.name === '?' || key.sequence === '?') setHelp(false)
        else if (key.name === 'j' || key.name === 'down') helpScroll.current?.scrollBy(1)
        else if (key.name === 'k' || key.name === 'up') helpScroll.current?.scrollBy(-1)
        else if (key.name === 'pagedown') helpScroll.current?.scrollBy(10)
        else if (key.name === 'pageup') helpScroll.current?.scrollBy(-10)
        return true
      }
      if (editing) { if (key.name === 'escape' || key.ctrl && key.name === 's') { setEditing(false); changeTab('Overview'); return true } return false }
      if (key.ctrl && key.name === 'n') { toggleSidebar(); return true }
      if (key.ctrl || key.meta || state.busy) return false
      const move = (delta: number) => {
        if (region === 'packs') choose(ids[Math.max(0, Math.min(ids.length - 1, ids.indexOf(state.selected) + delta))], false)
        else if (tab === 'Stages') setStageCursor(Math.max(0, Math.min(phases.length - 1, stage + delta)))
        else content.current?.scrollBy(delta)
      }
      const actions: Record<string, () => void> = {
        escape: () => { if (tab !== 'Overview') changeTab('Overview'); else if (region !== 'packs') { setRegion('packs'); if (!narrow) setSidebar(true) } else props.close() },
        '?': () => setHelp(true), '1': () => { setRegion('packs'); setSidebar(true) }, '2': () => setRegion('detail'),
        tab: () => { setRegion(region === 'packs' ? 'detail' : 'packs'); if (region === 'detail' && !narrow) setSidebar(true) },
        left: () => changeTab(TABS[(TABS.indexOf(tab) + TABS.length - 1) % TABS.length]), right: () => changeTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length]),
        pageup: () => content.current?.scrollBy(-Math.max(1, Math.floor(h / 2))), pagedown: () => content.current?.scrollBy(Math.max(1, Math.floor(h / 2))),
        j: () => move(1), down: () => move(1), k: () => move(-1), up: () => move(-1), return: () => setRegion('detail'),
        p: preview, i: () => { if (tab === 'Install' && missing) void state.install() }, f: () => changeTab(tab === 'Definition' ? 'Overview' : 'Definition'), e: importJson,
      }
      const action = actions[key.sequence === '?' ? '?' : key.name]; if (!action) return false; action(); return true
    }); return () => registerKeys(null)
  })
  const action = (label: string, run: () => void, enabled = true) => <box flexShrink={0} paddingX={1} onMouseDown={() => { if (focused && !state.busy && enabled) run() }}><text fg={enabled ? theme.cyan : theme.dim} wrapMode="none">{label}</text></box>
  const notice = state.selected === 'import' && !state.json.trim() ? '' : state.notice
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, props.zIndex ?? 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={overlay ? ' Workflow Packs ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>{action(narrow ? '[≡]' : showList ? '[◀]' : '[▶]', toggleSidebar)}<text fg={theme.cyan} wrapMode="none">{fitText(`[Repo] ${services.repository!.cwd.split('/').pop()} · ${WORKFLOW_PACKS.length} bundled packs`, Math.max(1, inner - 8))}</text></box>
    {notice ? <text fg={theme.amber} wrapMode="word">{notice}</text> : null}
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      {showList ? <box width={listWidth} flexShrink={0} flexDirection="column" backgroundColor={theme.surface2} border={!narrow ? ['right'] : false} borderColor={region === 'packs' ? theme.cyan : theme.border}>
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={region === 'packs' ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !editing) setRegion('packs') }}><text fg={theme.cyan}>[1] Packs</text></box>
        <scrollbox ref={list} flexGrow={1} minHeight={1}>
          {WORKFLOW_PACKS.map(pack => <box key={pack.id} ref={state.selected === pack.id ? selectedRow : undefined} height={2} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={state.selected === pack.id ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy && !editing) choose(pack.id) }}>
            <text fg={state.selected === pack.id ? theme.cyan : theme.text} wrapMode="none">{fitText(`${state.selected === pack.id ? '›' : ' '} ${pack.title}`, listWidth - 3)}</text>
            <text fg={theme.dim} wrapMode="none">{fitText(`v${pack.version} · ${pack.playbooks.length} workflow${pack.playbooks.length === 1 ? '' : 's'}`, listWidth - 3)}</text>
          </box>)}
          <box ref={state.selected === 'import' ? selectedRow : undefined} height={2} flexShrink={0} flexDirection="column" paddingX={1} backgroundColor={state.selected === 'import' ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy && !editing) choose('import') }}><text fg={state.selected === 'import' ? theme.cyan : theme.text}>Import a pack</text><text fg={theme.dim}>Local JSON definition</text></box>
        </scrollbox>
        {action('[e] Import JSON', importJson)}
      </box> : null}
      {showDetail ? <box width={narrow ? inner : detailWidth} flexShrink={0} minWidth={0} flexDirection="column" onMouseDown={() => { if (focused) setRegion('detail') }}>
        <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>{TABS.map(value => <box key={value} paddingX={1} backgroundColor={tab === value ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !editing) changeTab(value) }}><text fg={tab === value ? theme.cyan : theme.muted}>{value}</text></box>)}</box>
        {state.pack ? <><box height={1} flexShrink={0} paddingX={1}><text fg={theme.text} wrapMode="none">{fitText(state.pack.title, detailWidth - 2)}</text></box><box height={1} flexShrink={0} paddingX={1}><text fg={theme.dim} wrapMode="none">{`v${state.pack.version} · ${state.pack.playbooks.length} ${state.pack.playbooks.length === 1 ? 'workflow' : 'workflows'} · ${phases.length} ${phases.length === 1 ? 'stage' : 'stages'}`}</text></box></> : null}
        {editing ? <box flexGrow={1} minHeight={1} flexDirection="column" paddingX={1}><text fg={theme.cyan}>Import pack JSON · Ctrl+S inspect · Esc keep draft</text><textarea ref={editor} initialValue={state.json} focused={focused} flexGrow={1} width="100%" onContentChange={() => state.setJson(editor.current?.plainText ?? '')} /></box> : !state.pack ? <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2} gap={1}><text fg={theme.text}>Import a workflow pack</text><text fg={theme.dim} wrapMode="word">Paste a pack definition to inspect its workflows before installing.</text>{action('[e] Edit pack JSON', importJson)}</box> : tab === 'Stages' ? <>
          <scrollbox ref={stagesList} height={Math.max(2, Math.min(phases.length + 1, Math.floor(h / 3)))} minHeight={1} flexShrink={0} backgroundColor={theme.surface2} paddingX={1}>
            {phases.map((item, index) => <box key={`${item.playbook}:${item.index}`} ref={index === stage ? selectedStageRow : undefined} height={1} flexShrink={0} backgroundColor={index === stage ? theme.surface3 : undefined} onMouseDown={() => { if (focused) { setStageCursor(index); setRegion('detail') } }}><text fg={index === stage ? theme.cyan : theme.text} wrapMode="none">{fitText(`${index === stage ? '›' : ' '} ${index + 1}. ${item.phase.title} · ${item.phase.tasks.length} tasks`, detailWidth - 3)}</text></box>)}
          </scrollbox>
          <scrollbox key={`${state.selected}:${stage}`} ref={content} flexGrow={1} minHeight={1} padding={1}>
            {selectedStage ? <><text fg={theme.cyan} wrapMode="word">{selectedStage.playbook}</text>{selectedStage.phase.tasks.map((task, index) => <box key={task.key ?? index} flexDirection="column" marginBottom={1}><text fg={theme.text} wrapMode="word">{task.title}</text><text fg={theme.dim} wrapMode="word">{`${task.role}${task.dependsOn?.length ? ` · after ${task.dependsOn.join(', ')}` : ''}`}</text><text fg={theme.text} wrapMode="word">{task.detail}</text>{task.verifyCommands?.map((command, i) => <text key={i} fg={theme.amber} wrapMode="word">{`Verify: ${command}`}</text>)}</box>)}</> : null}
          </scrollbox>
        </> : tab === 'Install' ? <scrollbox ref={content} flexGrow={1} minHeight={1} padding={1}>
          <text fg={theme.cyan}>{state.rows ? `Installation preview · ${missing} missing · ${state.rows.filter(row => row.status === 'customized').length} customized` : 'Preview installation'}</text>
          <text fg={theme.dim} wrapMode="word">Only missing workflows are installed. Existing and customized files are kept.</text>
          {state.rows ? state.rows.map(row => <box key={row.name} flexDirection="column" paddingY={1}><text fg={row.status === 'missing' ? theme.amber : row.status === 'installed' ? theme.green : theme.dim} wrapMode="word">{`${row.name} · ${row.status}`}</text>{row.reason ? <text fg={theme.amber} wrapMode="word">{row.reason}</text> : null}</box>) : action('[p] Preview this repository', preview)}
          <text fg={theme.dim} wrapMode="word">Installation starts no agents. Choose an installed playbook in Start coordinated run.</text>
        </scrollbox> : tab === 'Definition' ? <scrollbox ref={content} flexGrow={1} minHeight={1} paddingX={1}><text fg={theme.text} wrapMode="word">{JSON.stringify(state.pack, null, 2)}</text></scrollbox> : <scrollbox ref={content} flexGrow={1} minHeight={1} padding={1}>
          <text fg={theme.text} wrapMode="word">{state.pack.description}</text>
          {state.pack.playbooks.map(playbook => <box key={playbook.name} flexDirection="column" paddingY={1}>
            <text fg={theme.cyan} wrapMode="word">{playbook.name}</text><text fg={theme.text} wrapMode="word">{playbook.description}</text>
            <text fg={theme.dim} wrapMode="word">{`Plan approval: ${playbook.requirePlanApproval ? 'required' : 'provider default'} · Review: ${playbook.requireReview ? 'required' : 'provider default'} · Up to ${playbook.maxAgents ?? 'default'} agents`}</text>
            {playbook.gateCommand ? <text fg={theme.amber} wrapMode="word">{`Gate: ${playbook.gateCommand}`}</text> : null}
            {playbook.phases.map((phase, index) => <box key={index} height={1} flexShrink={0} onMouseDown={() => { if (focused) { setStageCursor(phases.findIndex(item => item.playbook === playbook.name && item.index === index)); changeTab('Stages') } }}><text fg={theme.text} wrapMode="none">{fitText(` ${index + 1}. ${phase.title}`, detailWidth - 4)}</text></box>)}
          </box>)}
          <text fg={theme.dim}>Inspiration</text>{state.pack.sources.map(url => <text key={url} fg={theme.dim} wrapMode="word">{url}</text>)}
        </scrollbox>}
        {!editing && state.pack ? <box flexDirection="row" flexWrap="wrap" flexShrink={0} backgroundColor={theme.surface2}>{action('[p] Preview installation', preview)}{tab === 'Install' ? action('[i] Install missing', () => { void state.install() }, Boolean(missing)) : null}</box> : null}
      </box> : null}
    </box>
    <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(help ? '' : state.busy ? 'Working…' : editing ? 'Ctrl+S inspect JSON · Esc keep draft' : 'Tab focus · ←/→ tabs · ? help · Esc back/close', inner - 2)}</text></box>
    {help ? <ShortcutHelp title="Workflow pack shortcuts" groups={HELP} theme={theme} width={inner} height={h - (overlay ? 2 : 0)} scrollRef={helpScroll} onClose={() => { if (focused) setHelp(false) }} /> : null}
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'workflow-packs', views: { 'workflow-packs': WorkflowPacks } }
