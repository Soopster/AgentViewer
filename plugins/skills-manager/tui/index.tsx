/** @jsxImportSource @opentui/react */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import { skillCopyStatus } from '../../../lib/plugins/skillsManager'
import { popoverRootProps, PopoverDetachButton, fitText, ShortcutHelp, type ShortcutHelpGroup, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { useSkillsView, type SkillsViewState } from '../useSkillsView'
const SkillMarkdown = lazy(() => import('./SkillMarkdown').then(module => ({ default: module.SkillMarkdown })))
const TABS = ['skills', 'resources', 'targets', 'preview', 'history'] as const
type Mode = typeof TABS[number]
type Region = 'locations' | 'skills' | 'detail'
const TAB_LABELS: Record<Mode, string> = { skills: 'Content', resources: 'Files', targets: 'Copy', preview: 'Preview', history: 'History' }
const HELP: readonly ShortcutHelpGroup[] = [
  { title: 'Navigate', rows: [['1 / 2 / 3', 'Locations / skills / details'], ['Tab / Shift+Tab', 'Next / previous pane'], ['← / →', 'Switch detail tabs'], ['j/k or ↑/↓', 'Move selection or scroll content'], ['Enter', 'Open selected skill or file'], ['Ctrl+N', 'Toggle locations']] },
  { title: 'Read and find', rows: [['/', 'Search skills'], ['[ / ]', 'Previous / next location'], ['v', 'Toggle raw / rich Markdown'], ['Backspace', 'Back to files / parent folder'], ['h', 'Show copy history'], ['r', 'Refresh inventory']] },
  { title: 'Copy', rows: [['Space', 'Select destination or replacement'], ['p', 'Preview selected copies'], ['a', 'Apply the reviewed preview']] },
]
type Theme = TuiPluginViewProps['theme']

function Targets({ state, cursor, theme, onChoose }: { state: SkillsViewState; cursor: number; theme: Theme; onChoose: (index: number) => void }) {
  const scroll = useRef<ScrollBoxRenderable>(null), row = useRef<BoxRenderable>(null)
  useEffect(() => { if (row.current) scroll.current?.scrollChildIntoView(row.current) }, [cursor])
  if (!state.snapshot || !state.skill) return <text fg={theme.dim}>Select a skill to choose destinations.</text>
  const roots = state.snapshot.roots.filter(root => root.id !== state.skill!.rootId)
  return <scrollbox ref={scroll} flexGrow={1} minHeight={1} paddingX={1}>
    <text fg={theme.cyan}>Copy destinations · Space toggles selection</text>
    <text fg={theme.dim} wrapMode="word">Select locations, then preview the file changes before applying.</text>
    {roots.map((root, index) => <box key={root.id} ref={index === cursor ? row : undefined} flexDirection="column" paddingY={1} backgroundColor={index === cursor ? theme.surface2 : undefined} onMouseDown={() => onChoose(index)}>
      <text fg={!root.writable ? theme.dim : index === cursor ? theme.cyan : theme.text} wrapMode="word">{`${index === cursor ? '›' : ' '} [${state.targetIds.includes(root.id) ? 'x' : ' '}] ${root.label}`}</text>
      <text fg={theme.dim} wrapMode="word">{`${root.scope} · ${skillCopyStatus(state.snapshot!, state.skill!, root.id)}${root.writable ? '' : ' · read only'}`}</text>
      <text fg={theme.dim} wrapMode="word">{root.path}</text>
      <text fg={theme.dim} wrapMode="word">{root.consumers.join(', ')}{root.note ? ` · ${root.note}` : ''}</text>
    </box>)}
  </scrollbox>
}
function Preview({ state, cursor, theme, onChoose }: { state: SkillsViewState; cursor: number; theme: Theme; onChoose: (index: number) => void }) {
  const scroll = useRef<ScrollBoxRenderable>(null), row = useRef<BoxRenderable>(null)
  useEffect(() => { if (row.current) scroll.current?.scrollChildIntoView(row.current) }, [cursor])
  if (!state.preview) return <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2} gap={1}>
    <text fg={theme.text}>Preview a skill copy</text>
    <text fg={theme.dim} wrapMode="word">Choose destinations in Copy, then press p to inspect changes.</text>
  </box>
  return <scrollbox ref={scroll} flexGrow={1} minHeight={1} paddingX={1}>
    <text fg={theme.cyan}>Copy preview</text>
    <text fg={theme.dim} wrapMode="word">Replacements require explicit selection and create a backup.</text>
    {state.preview.targets.map((target, index) => <box key={target.rootId} ref={index === cursor ? row : undefined} flexDirection="column" paddingY={1} backgroundColor={index === cursor ? theme.surface2 : undefined} onMouseDown={() => onChoose(index)}>
      <text fg={target.status === 'blocked' ? theme.red : target.status === 'add' ? theme.green : theme.cyan} wrapMode="word">{`${index === cursor ? '›' : ' '} ${target.status}${target.status === 'replace' ? state.replaceIds.includes(target.rootId) ? ' [x] replace with backup' : ' [ ] replacement not selected' : ''}`}</text>
      <text fg={theme.text} wrapMode="word">{target.path}</text>
      {target.reason ? <text fg={theme.amber} wrapMode="word">{target.reason}</text> : null}
      {target.files.filter(file => file.status !== 'same').map(file => <text fg={file.status === 'add' ? theme.green : file.status === 'remove' ? theme.red : theme.amber} key={file.path} wrapMode="word">{`${file.status === 'add' ? '+' : file.status === 'remove' ? '-' : '~'} ${file.path}`}</text>)}
    </box>)}
  </scrollbox>
}
function History({ state, theme, scrollRef }: { state: SkillsViewState; theme: Theme; scrollRef: { current: ScrollBoxRenderable | null } }) {
  const receipts = [state.receipt, ...(state.snapshot?.receipts ?? []).filter(receipt => receipt.id !== state.receipt?.id)].filter(Boolean)
  return <scrollbox ref={scrollRef} flexGrow={1} minHeight={1} paddingX={1}>
    {!receipts.length ? <text fg={theme.dim}>No copies yet. Completed copies and backups appear here.</text> : null}
    {receipts.map(receipt => <box key={receipt!.id} flexDirection="column" paddingY={1}>
      <text fg={receipt!.status === 'applied' ? theme.green : theme.amber}>{`${receipt!.sourceName} · ${receipt!.status}`}</text>
      {receipt!.error ? <text fg={theme.amber} wrapMode="word">{receipt!.error}</text> : null}
      {receipt!.results.map(result => <box key={result.rootId} flexDirection="column">
        <text fg={theme.text} wrapMode="word">{`${result.status} · ${result.path}`}</text>
        {result.backup ? <text fg={theme.dim} wrapMode="word">{`Backup: ${result.backup}`}</text> : null}
        {result.error ? <text fg={theme.amber} wrapMode="word">{result.error}</text> : null}
      </box>)}
    </box>)}
  </scrollbox>
}
function SkillsManager(props: TuiPluginViewProps) {
  const { services, theme, width, height, placement, focused, setCapture, detach, useState: scoped } = props
  const state = useSkillsView(services['skills-manager']!, services.repository!.cwd, scoped)
  const [mode, setMode] = scoped<Mode>('mode', 'skills'), [cursor, setCursor] = scoped('cursor', 0)
  const [directory, setDirectory] = scoped('resource-directory', '')
  const [richMarkdown, setRichMarkdown] = scoped('rich-markdown', false)
  const [region, setRegion] = scoped<Region>('region', 'skills'), [sidebar, setSidebar] = scoped('sidebar', true)
  const [navigationOpen, setNavigationOpen] = useState(false), [searching, setSearching] = useState(false), [help, setHelp] = useState(false)
  const input = useRef<TextareaRenderable>(null), skillList = useRef<ScrollBoxRenderable>(null), selectedSkillRow = useRef<BoxRenderable>(null)
  const locationList = useRef<ScrollBoxRenderable>(null), selectedLocationRow = useRef<BoxRenderable>(null)
  const fileList = useRef<ScrollBoxRenderable>(null), selectedFileRow = useRef<BoxRenderable>(null)
  const helpScroll = useRef<ScrollBoxRenderable>(null)
  const content = useRef<ScrollBoxRenderable>(null), historyScroll = useRef<ScrollBoxRenderable>(null)
  const overlay = placement === 'overlay', w = overlay ? Math.max(1, Math.min(width - 4, 160)) : width, h = overlay ? Math.max(1, height - 4) : height
  const inner = Math.max(1, w - 2), narrow = w < 80, full = w >= 110
  const showLocations = full ? sidebar : navigationOpen
  const showSkills = (full || !navigationOpen) && (!narrow || region === 'skills')
  const showDetail = (full || !navigationOpen) && (!narrow || region === 'detail')
  const locationWidth = full ? Math.min(28, Math.floor(inner * .21)) : inner
  const listWidth = narrow ? inner : Math.min(34, Math.floor(inner * .27))
  const detailWidth = Math.max(1, inner - (showLocations ? locationWidth : 0) - (showSkills ? listWidth : 0))
  const isMarkdown = /\.(?:md|markdown|mdown|mkd)$/i.test(state.file)
  const roots = state.snapshot?.roots ?? [], destinations = roots.filter(root => root.id !== state.skill?.rootId), allFiles = state.skill?.files ?? []
  const files = allFiles.filter(file => !directory || file.path.startsWith(directory + '/'))
  const fileParts = state.file.split('/')
  const crumbParts = mode === 'resources' ? directory.split('/').filter(Boolean) : fileParts.slice(0, -1)
  const browseFiles = (path = '') => {
    setDirectory(path)
    const visible = allFiles.filter(file => !path || file.path.startsWith(path + '/'))
    setCursor(Math.max(0, visible.findIndex(file => file.path === state.file)))
    setMode('resources'); setRegion('detail'); setNavigationOpen(false); setSearching(false)
  }
  const locations = [{ id: '', label: 'All locations', path: services.repository!.cwd }, ...roots]
  const changeMode = (next: Mode) => { if (next === 'resources') { browseFiles(); return } setSearching(false); setMode(next); setCursor(0); setRegion('detail'); setNavigationOpen(false) }
  const focusLocations = () => { setSearching(false); if (full) setSidebar(true); else setNavigationOpen(true); setRegion('locations') }
  const toggleSidebar = () => { setSearching(false); if (full) { setSidebar(!sidebar); if (region === 'locations') setRegion('skills') } else { setNavigationOpen(!navigationOpen); setRegion(navigationOpen ? 'skills' : 'locations') } }
  const chooseLocation = (id: string) => { setSearching(false); state.setRootId(id); setRegion('skills'); setNavigationOpen(false) }
  const toggleDestination = (at: number) => { if (focused && !state.busy) { setCursor(at); if (destinations[at]?.writable) state.toggleTarget(destinations[at].id) } }
  const toggleReplacement = (at: number) => { if (focused && !state.busy) { setCursor(at); const target = state.preview?.targets[at]; if (target?.status === 'replace') state.toggleReplacement(target.rootId) } }
  const prepare = () => { void state.prepare().then(() => changeMode('preview')) }
  useEffect(() => { setCapture(focused ? searching ? 'input' : help : false); return () => setCapture(false) }, [searching, help, focused, setCapture])
  useEffect(() => { if (selectedSkillRow.current) skillList.current?.scrollChildIntoView(selectedSkillRow.current) }, [state.skill?.id, showSkills])
  useEffect(() => { if (selectedLocationRow.current) locationList.current?.scrollChildIntoView(selectedLocationRow.current) }, [state.rootId, showLocations])
  useEffect(() => { if (selectedFileRow.current) fileList.current?.scrollChildIntoView(selectedFileRow.current) }, [cursor, mode])
  const fileOwner = useRef(state.skill?.id)
  useEffect(() => { if (fileOwner.current !== state.skill?.id) { fileOwner.current = state.skill?.id; setDirectory(''); setCursor(0) } }, [state.skill?.id, setDirectory, setCursor])
  useEffect(() => { content.current?.scrollTo(0) }, [state.skill?.id, state.file, richMarkdown])
  useEffect(() => {
    props.registerKeys(key => {
      if (!focused) return false
      if (help) {
        if (key.name === 'escape' || key.name === '?' || key.sequence === '?') setHelp(false)
        else if (key.name === 'j' || key.name === 'down') helpScroll.current?.scrollBy(1)
        else if (key.name === 'k' || key.name === 'up') helpScroll.current?.scrollBy(-1)
        else if (key.name === 'pagedown') helpScroll.current?.scrollBy(10)
        else if (key.name === 'pageup') helpScroll.current?.scrollBy(-10)
        return true
      }
      if (searching) {
        if (key.name === 'escape' || key.name === 'return' || key.ctrl && key.name === 's') { setSearching(false); return true }
        return false
      }
      if (key.ctrl && key.name === 'n') { toggleSidebar(); return true }
      if (key.ctrl || key.meta || state.busy) return false
      if (key.name === 'escape') {
        if (help) setHelp(false)
        else if (navigationOpen) { setNavigationOpen(false); setRegion('skills') }
        else if (region === 'detail' && mode !== 'skills') changeMode('skills')
        else if (region !== 'skills') setRegion('skills')
        else props.close()
        return true
      }
      const move = (delta: number) => {
        if (region === 'locations') {
          const at = locations.findIndex(root => root.id === state.rootId)
          const next = locations[Math.max(0, Math.min(locations.length - 1, at + delta))]
          if (next) state.setRootId(next.id)
        } else if (region === 'skills') {
          const at = state.skills.findIndex(skill => skill.id === state.skill?.id), next = state.skills[Math.max(0, Math.min(state.skills.length - 1, at + delta))]
          if (next) { state.setSkillId(next.id); setCursor(0) }
        } else if (mode === 'skills') content.current?.scrollBy(delta)
        else if (mode === 'history') historyScroll.current?.scrollBy(delta)
        else {
          const count = mode === 'targets' ? destinations.length : mode === 'resources' ? files.length : state.preview?.targets.length ?? 0
          setCursor(Math.max(0, Math.min(Math.max(0, count - 1), cursor + delta)))
        }
      }
      const actions: Record<string, () => void> = {
        '1': focusLocations,
        '2': () => { setNavigationOpen(false); setRegion('skills') },
        '3': () => { setNavigationOpen(false); setRegion('detail') },
        '/': () => { setNavigationOpen(false); setRegion('skills'); setSearching(true) },
        '?': () => setHelp(!help),
        'tab': () => {
          if (navigationOpen) { setNavigationOpen(false); setRegion('skills'); return }
          const regions: Region[] = [...(showLocations ? ['locations' as const] : []), 'skills', 'detail']
          setRegion(regions[(regions.indexOf(region) + (key.shift ? regions.length - 1 : 1)) % regions.length])
        },
        'left': () => changeMode(TABS[(TABS.indexOf(mode) + TABS.length - 1) % TABS.length]),
        'right': () => changeMode(TABS[(TABS.indexOf(mode) + 1) % TABS.length]),
        'r': () => { void state.refresh() },
        'backspace': () => { if (region === 'detail' && mode === 'skills') browseFiles(directory); else if (region === 'detail' && mode === 'resources') browseFiles(directory.split('/').slice(0, -1).join('/')) },
        'v': () => { if (mode === 'skills' && isMarkdown) { setRichMarkdown(!richMarkdown); setRegion('detail'); setNavigationOpen(false) } },
        'h': () => changeMode(mode === 'history' ? 'skills' : 'history'),
        'p': prepare,
        'a': () => { if (mode === 'preview' && state.canApply) void state.apply() },
        '[': () => { const at = locations.findIndex(root => root.id === state.rootId); state.setRootId(locations[Math.max(0, at - 1)].id) },
        ']': () => { const at = locations.findIndex(root => root.id === state.rootId); state.setRootId(locations[Math.min(locations.length - 1, at + 1)].id) },
        'space': () => { if (region === 'detail' && mode === 'targets') toggleDestination(cursor); else if (region === 'detail' && mode === 'preview') toggleReplacement(cursor) },
        'return': () => {
          if (region === 'locations') chooseLocation(state.rootId)
          else if (region === 'skills') changeMode('skills')
          else if (mode === 'resources' && files[cursor]) { state.setFileName(files[cursor].path); setMode('skills'); setRegion('detail') }
        },
        'j': () => move(1), 'down': () => move(1), 'k': () => move(-1), 'up': () => move(-1),
      }
      const action = actions[key.sequence === '?' ? '?' : key.name]
      if (!action) return false
      action(); return true
    })
    return () => props.registerKeys(null)
  })
  const action = (label: string, run: () => void, enabled = true) => <box flexShrink={0} paddingX={1} onMouseDown={() => { if (focused && !state.busy && enabled) run() }}><text fg={enabled ? theme.cyan : theme.dim} wrapMode="none">{label}</text></box>
  const breadcrumbs = <box flexDirection="row" flexGrow={1} minWidth={0} overflow="hidden">
    {action('Files', () => browseFiles())}
    {crumbParts.map((part, index) => <box key={index} flexShrink={0} flexDirection="row"><text fg={theme.dim}> / </text>{action(part, () => browseFiles(crumbParts.slice(0, index + 1).join('/')))}</box>)}
    {mode === 'skills' ? <text fg={theme.text} wrapMode="none">{` / ${fileParts.at(-1)}`}</text> : null}
  </box>
  return <box {...popoverRootProps(!overlay, { top: 2, left: Math.max(0, Math.floor((width - w) / 2)), width: w, height: h }, props.zIndex ?? 50)} border={overlay} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" overflow="hidden" title={overlay ? ' Skills Manager ' : undefined}>
    {overlay && detach ? <PopoverDetachButton theme={theme} onPress={detach} /> : null}
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
      {action(full ? showLocations ? '[◀]' : '[▶]' : '[≡]', toggleSidebar)}
      <text fg={theme.cyan} wrapMode="none">{fitText(`[Repo] ${services.repository!.cwd.split('/').pop()} · ${state.snapshot ? `${state.skills.length} skills` : 'Loading…'}`, Math.max(1, inner - 8))}</text>
    </box>
    {state.notice ? <text fg={theme.amber} wrapMode="word">{state.notice}</text> : null}
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      {showLocations ? <box width={locationWidth} flexShrink={0} flexDirection="column" backgroundColor={theme.surface2} border={full ? ['right'] : false} borderColor={region === 'locations' ? theme.cyan : theme.border}>
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={region === 'locations' ? theme.surface3 : undefined} onMouseDown={() => { if (focused) setRegion('locations') }}><text fg={theme.cyan}>[1] Locations</text></box>
        <scrollbox ref={locationList} flexGrow={1} minHeight={1}>
          {locations.map(root => {
            const count = root.id ? state.snapshot?.skills.filter(skill => skill.rootId === root.id).length ?? 0 : state.snapshot?.skills.length ?? 0
            const label = root.label.replace(/ skills$/, '').replace('GitHub Copilot', 'Copilot')
            const countText = String(count), labelWidth = Math.max(1, locationWidth - countText.length - 5)
            return <box key={root.id} ref={root.id === state.rootId ? selectedLocationRow : undefined} flexDirection="row" height={1} flexShrink={0} paddingX={1} backgroundColor={root.id === state.rootId ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy) chooseLocation(root.id) }}>
              <text fg={root.id === state.rootId ? theme.cyan : theme.text} wrapMode="none">{fitText(`${root.id === state.rootId ? '›' : ' '} ${label}`, labelWidth).padEnd(labelWidth)}</text>
              <text fg={theme.dim} wrapMode="none">{` ${countText}`}</text>
            </box>
          })}
        </scrollbox>
        {action('[r] Refresh', () => { void state.refresh() })}
      </box> : null}
      {showSkills ? <box width={listWidth} flexShrink={0} flexDirection="column" border={!narrow ? ['right'] : false} borderColor={region === 'skills' ? theme.cyan : theme.border}>
        <box height={1} flexShrink={0} paddingX={1} backgroundColor={region === 'skills' ? theme.surface3 : theme.surface2} onMouseDown={() => { if (focused) setRegion('skills') }}><text fg={theme.cyan}>{`[2] Skills (${state.skills.length})`}</text></box>
        <box height={1} flexShrink={0} paddingX={1} onMouseDown={() => { if (focused) setSearching(true) }}><text fg={theme.dim} wrapMode="none">{fitText(`/ ${state.query || 'Search skills'}`, listWidth - 3)}</text></box>
        {searching ? <box height={3} flexShrink={0}><textarea ref={input} initialValue={state.query} focused={focused} width="100%" onContentChange={() => state.setQuery(input.current?.plainText ?? '')} /></box> : null}
        <scrollbox ref={skillList} flexGrow={1} minHeight={1}>
          {state.skills.map(skill => <box key={skill.id} ref={skill.id === state.skill?.id ? selectedSkillRow : undefined} flexDirection="column" height={2} flexShrink={0} paddingX={1} backgroundColor={skill.id === state.skill?.id ? theme.surface3 : undefined} onMouseDown={() => { if (focused && !state.busy) { setSearching(false); state.setSkillId(skill.id); setCursor(0); if (narrow) setRegion('detail'); else setRegion('skills') } }}>
            <text fg={skill.id === state.skill?.id ? theme.cyan : theme.text} wrapMode="none">{fitText(`${skill.id === state.skill?.id ? '›' : ' '} ${skill.name}`, Math.max(1, listWidth - 4))}</text>
            <text fg={theme.dim} wrapMode="none">{fitText(`${state.snapshot?.roots.find(root => root.id === skill.rootId)?.label}${skill.linked ? ' · linked' : ''}`, Math.max(1, listWidth - 4))}</text>
          </box>)}
          {!state.skills.length ? <box padding={1}><text fg={theme.dim} wrapMode="word">{state.snapshot ? state.query ? 'No matching skills. Clear the search or choose another location.' : 'No skills in this location. Choose another location to browse.' : 'Loading skills…'}</text></box> : null}
        </scrollbox>
      </box> : null}
      {showDetail ? <box width={narrow ? inner : detailWidth} flexShrink={0} minWidth={0} flexDirection="column" onMouseDown={() => { if (focused) setRegion('detail') }}>
        <box flexDirection="row" height={1} flexShrink={0} backgroundColor={theme.surface2} overflow="hidden">
          {TABS.map(value => <box key={value} paddingX={1} backgroundColor={mode === value ? theme.surface3 : undefined} onMouseDown={() => { if (focused) changeMode(value) }}><text fg={mode === value ? theme.cyan : theme.muted}>{TAB_LABELS[value]}</text></box>)}
        </box>
        {state.skill ? <>
          <box height={1} flexShrink={0}><text fg={theme.text} wrapMode="none">{fitText(` ${state.skill.name}`, detailWidth - 1)}</text></box>
          <box height={1} flexShrink={0}><text fg={theme.dim} wrapMode="none">{fitText(` ${state.sourceRoot?.label} · ${state.sourceRoot?.scope}${state.skill.linked ? ' · linked' : ''}`, detailWidth - 1)}</text></box>
          {state.skill.issues.length ? <text fg={theme.amber} wrapMode="word">{state.skill.issues.join('; ')}</text> : null}
        </> : null}
        {mode === 'history' ? <History state={state} theme={theme} scrollRef={historyScroll} /> : !state.skill ? <box flexGrow={1} flexDirection="column" justifyContent="center" alignItems="center" paddingX={2} gap={1}>
          <text fg={theme.text}>Browse installed skills</text>
          <text fg={theme.dim} wrapMode="word">Choose a location and skill to read its instructions, inspect files, or copy it.</text>
          {action('[1] Choose a location', focusLocations)}
        </box> : mode === 'targets' ? <Targets state={state} cursor={cursor} theme={theme} onChoose={toggleDestination} /> : mode === 'preview' ? <Preview state={state} cursor={cursor} theme={theme} onChoose={toggleReplacement} /> : mode === 'resources' ? <scrollbox ref={fileList} flexGrow={1} minHeight={1} paddingX={1}>
          <text fg={theme.cyan}>Skill files · Enter opens</text>
          <box height={1} flexShrink={0} flexDirection="row">{breadcrumbs}</box>
          <text fg={theme.dim} wrapMode="word">{`${state.sourceRoot?.path}/${state.skill.key}`}</text>
          {files.map((file, index) => <box key={file.path} ref={cursor === index ? selectedFileRow : undefined} backgroundColor={cursor === index ? theme.surface2 : undefined} onMouseDown={() => { if (focused) { state.setFileName(file.path); setMode('skills'); setRegion('detail') } }}><text fg={cursor === index ? theme.cyan : theme.text} wrapMode="word">{`${cursor === index ? '›' : ' '} ${directory ? file.path.slice(directory.length + 1) : file.path} · ${file.bytes} bytes`}</text></box>)}
        </scrollbox> : <>
          <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2}>
            {breadcrumbs}
            {isMarkdown ? <>{action(richMarkdown ? 'Raw' : '[Raw]', () => setRichMarkdown(false))}{action(richMarkdown ? '[Rich]' : 'Rich', () => setRichMarkdown(true))}</> : null}
          </box>
          <scrollbox key={`${state.skill.id}:${state.file}:${isMarkdown && richMarkdown}`} ref={content} flexGrow={1} minHeight={1} paddingX={1}>
            {isMarkdown && richMarkdown ? <Suspense fallback={<text fg={theme.dim}>Loading Markdown preview…</text>}><SkillMarkdown text={state.fileText} width={Math.max(1, detailWidth - 3)} theme={theme} syntaxStyle={props.syntaxStyle} /></Suspense> : <text fg={theme.text} wrapMode="word">{state.fileText}</text>}
          </scrollbox>
        </>}
        {state.skill ? <box flexDirection="row" flexWrap="wrap" flexShrink={0} backgroundColor={theme.surface2}>
          {mode === 'preview' ? <>{action('[a] Apply copies', () => { void state.apply() }, state.canApply)}{action('Edit destinations', () => changeMode('targets'))}</> : <>{action(`Copy to (${state.targetIds.length})`, () => changeMode('targets'))}{action('[p] Preview', prepare, Boolean(state.targetIds.length))}</>}
        </box> : null}
      </box> : null}
    </box>
    {state.snapshot?.diagnostics.length ? <text fg={theme.amber} wrapMode="none">{fitText(`Discovery: ${state.snapshot.diagnostics[0]}`, inner)}</text> : null}
    <box height={1} flexShrink={0} paddingX={1}><text fg={state.busy ? theme.amber : theme.dim} wrapMode="none">{fitText(help ? '' : state.busy ? 'Working…' : searching ? 'Search skills · Enter done · Esc back' : 'Tab focus · ←/→ tabs · / search · ? help · Esc back/close', inner - 2)}</text></box>
    {help ? <ShortcutHelp title="Skills shortcuts" groups={HELP} theme={theme} width={inner} height={h - (overlay ? 2 : 0)} scrollRef={helpScroll} onClose={() => { if (focused) setHelp(false) }} /> : null}
  </box>
}
export const module: PluginViewModule<TuiPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'skills-manager', views: { 'skills-manager': SkillsManager } }
