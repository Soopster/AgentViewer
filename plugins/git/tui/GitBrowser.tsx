/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { GitKeyEvent, GitPopoverProps } from './GitPopover'
import { GitReviewPopover } from './GitPopover'
import { GitWorkspace } from './GitWorkspace'
import { GitWorkflowMenu } from './GitWorkflowMenu'
import { PopoverDetachButton } from '../../../tui/opentui/shell/sdk'
import { git } from '../../../lib/git/command'
import { useGitWorkspace } from '../../../lib/git/useGitWorkspace'
import { localWorkspaceTransport } from '../../../lib/git/workspaceService'
import type { WorkflowContext } from '../../../lib/git/workflowMenu'
import { browseCommit, browseDirectory, browseHistory, browseWorktrees, EMPTY_TREE, type BrowseCommit, type BrowseWorktree } from '../../../lib/git/browse'
import type { DiffSourceSelection } from '../../../lib/gitDiffSourceMenu'
import { RetainedWindow, useWindowVisible } from '../../../tui/opentui/shell/sdkDiff'
import { CommitDetails } from './CommitDetails'
import { GitDivider } from './GitDivider'
import { GitSidebar, type GitNavigation as Navigation } from './GitSidebar'
import { RevisionTree } from './RevisionTree'

type DetailTab = 'Commit' | 'Changes' | 'File Tree'
type Region = 'navigation' | 'history' | 'tabs' | 'detail'

const TABS: DetailTab[] = ['Commit', 'Changes', 'File Tree']
const GROUPS = ['Worktrees', 'Branches', 'Remotes', 'Tags', 'Stashes', 'Submodules']
const fitLabel = (value: string, columns: number) => value.length <= columns ? value : `${value.slice(0, Math.max(0, columns - 1))}…`
const safeLabel = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, ' ')

export function GitBrowser(props: GitPopoverProps) {
  const parentVisible = useWindowVisible()
  const initialRoot = props.cwd || process.cwd()
  const [root, setRoot] = useState<string | null>(null)
  const [resolvingError, setResolvingError] = useState('')
  useEffect(() => {
    let live = true
    setRoot(null); setResolvingError('')
    void git(initialRoot, ['rev-parse', '--show-toplevel']).then(value => { if (live) setRoot(value.trimEnd()) }).catch(e => { if (live) setResolvingError(String(e)) })
    return () => { live = false }
  }, [initialRoot])
  useEffect(() => {
    if (!root && parentVisible) {
      props.onKeyHandlerReady(key => { if (key.name === 'escape') props.onClose() })
      props.onKeyCaptureChange?.(false)
    }
  }, [root, parentVisible, props.onKeyHandlerReady, props.onKeyCaptureChange, props.onClose])
  // Keep each worktree's panel mounted so drafts, tab choices and scroll positions survive switching.
  const [visited, setVisited] = useState<string[]>([])
  const switchRoot = useCallback((next: string) => { setVisited(old => [...new Set([...old, ...(root ? [root] : []), next])]); setRoot(next) }, [root])
  // Overlay hosts render after the app content; the outer wrapper must not enter flow.
  const placement = props.docked ? {} : { position: 'absolute' as const, top: 0, left: 0, zIndex: props.zIndex ?? 50 }
  if (!root) return <box {...placement} id="git-browser" width={props.width} height={props.height} backgroundColor={props.theme.surface}><text fg={resolvingError ? props.theme.red : props.theme.muted}>{resolvingError || 'Loading Git repository…'}</text></box>
  const roots = visited.includes(root) ? visited : [...visited, root]
  return <box {...placement} id="git-browser" width={props.width} height={props.height}>
    {roots.map(path => <box key={path} visible={path === root} width={props.width} height={props.height} position="absolute" top={0} left={0}>
      <RetainedWindow visible={path === root && parentVisible}><RepositoryBrowser {...props} cwd={path} active={path === root && parentVisible} switchRoot={switchRoot} /></RetainedWindow>
    </box>)}
  </box>
}

function RepositoryBrowser(props: GitPopoverProps & { active: boolean; switchRoot: (root: string) => void }) {
  const { theme, cwd, active, width, height, docked, onClose, switchRoot } = props
  const contextCwd = cwd || process.cwd()
  const workspace = useGitWorkspace(contextCwd, localWorkspaceTransport)
  const { snapshot } = workspace
  const root = snapshot?.root ?? contextCwd
  useEffect(() => { if (active) void workspace.refresh() }, [active, workspace.refresh])
  const [worktrees, setWorktrees] = useState<BrowseWorktree[]>([])
  const [selection, setSelection] = useState<Navigation>({ id: 'local', label: 'Local Changes', kind: 'local' })
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(GROUPS))
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(26)
  const [historyRows, setHistoryRows] = useState<number | null>(null)
  const [sidebarFilter, setSidebarFilter] = useState('')
  const [filterEditing, setFilterEditing] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [submodules, setSubmodules] = useState<string[]>([])
  const [tab, setTab] = useState<DetailTab>('Changes')
  const [region, setRegion] = useState<Region>('detail')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [navCursor, setNavCursor] = useState(0)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [historyOnly, setHistoryOnly] = useState(false)
  const [history, setHistory] = useState<BrowseCommit[]>([])
  const [historyTop, setHistoryTop] = useState(0)
  const [historyCursor, setHistoryCursor] = useState(0)
  const [historyLimit, setHistoryLimit] = useState(100)
  const [hasMore, setHasMore] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<BrowseCommit | null>(null)
  const [rangeAnchor, setRangeAnchor] = useState<number | null>(null)
  const [range, setRange] = useState<{ base: string; head: string } | null>(null)
  const [filePath, setFilePath] = useState<string | undefined>()
  const [staging, setStaging] = useState(false)
  const [menu, setMenu] = useState<{ snapshot: NonNullable<typeof snapshot>; context: WorkflowContext } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [childBusy, setChildBusy] = useState(false)
  const [childCapture, setChildCapture] = useState(false)
  const childKey = useRef<(key: GitKeyEvent) => boolean | void>(() => false)
  const menuKey = useRef<(key: GitKeyEvent) => boolean | void>(() => false)
  const loadedHistory = useRef<{ key: string; commits: BrowseCommit[]; exhausted: boolean }>({ key: '', commits: [], exhausted: false })
  const historyScroll = useRef<ScrollBoxRenderable>(null)
  const navScroll = useRef<ScrollBoxRenderable>(null)
  const popW = Math.max(20, docked ? width : width - 2), popH = Math.max(8, docked ? height : height - 2)
  const narrow = popW < 110, short = popH < 32
  const sidebarOverlay = narrow || sidebarHidden
  const navW = sidebarOverlay ? 0 : Math.max(22, Math.min(sidebarWidth, Math.floor(popW * .45), popW - 60))
  const bodyH = Math.max(1, popH - (docked ? 2 : 4))
  const contentW = popW - navW - (docked ? 0 : 2)
  const historyH = historyVisible ? short ? Math.max(3, popH - (docked ? 2 : 4)) : Math.max(5, Math.min(historyRows ?? Math.floor(popH / 4), bodyH - 10)) : 0
  const showHistory = historyVisible && (!short || historyOnly)
  const showDetail = !short || !showHistory
  const detailH = Math.max(3, popH - (docked ? 4 : 6) - (showHistory ? historyH : 0))
  const isLocal = selection.kind === 'local'
  const historyRef = selection.kind === 'branch' ? `refs/heads/${selection.ref}` : selection.kind === 'remote-branch' ? `refs/remotes/${selection.ref}` : selection.kind === 'tag' ? `refs/tags/${selection.ref}` : '--all'
  const navigation = useMemo(() => {
    const rows: Navigation[] = [{ id: 'local', label: `Local Changes (${snapshot?.files.length ?? 0})`, kind: 'local' }, { id: 'history', label: 'All Commits', kind: 'history' }]
    const query = sidebarFilter.trim().toLowerCase()
    const append = (name: string, items: Navigation[], depth = 0, collapsedByDefault = false, effectiveQuery = query) => {
      const matchesGroup = name.toLowerCase().includes(effectiveQuery)
      const matches = effectiveQuery && !matchesGroup ? items.filter(item => item.label.toLowerCase().includes(effectiveQuery)) : items
      if (effectiveQuery && !matchesGroup && !matches.length) return
      const id = depth ? `remote-group:${name}` : name
      const closed = collapsed.has(id) || collapsedByDefault && !collapsed.has(`open:${id}`)
      rows.push({ id, label: `${'  '.repeat(depth)}${query || !closed ? '▼' : '▶'} ${name} (${items.length})`, kind: 'group', depth })
      if (query || !closed) rows.push(...matches.map(item => ({ ...item, depth: depth + 1 })))
    }
    append('Worktrees', worktrees.map(w => ({ id: w.path, label: `${w.branch} · ${w.path.split('/').pop()}`, kind: 'worktree', path: w.path })))
    append('Branches', snapshot?.branchRefs.map(b => ({ id: `branch:${b.name}`, label: `${b.name === snapshot.branch ? '● ' : ''}${b.name}`, kind: 'branch', ref: b.name })) ?? [])
    const remotes = snapshot?.remotes ?? []
    const matchingRemotes = query ? remotes.filter(remote => remote.toLowerCase().includes(query) || snapshot?.remoteBranches.some(b => b.remote === remote && b.name.toLowerCase().includes(query))) : remotes
    if (!query || 'remotes'.includes(query) || matchingRemotes.length) {
      rows.push({ id: 'Remotes', label: `${query || !collapsed.has('Remotes') ? '▼' : '▶'} Remotes (${remotes.length})`, kind: 'group' })
      if (query || !collapsed.has('Remotes')) for (const remote of ('remotes'.includes(query) ? remotes : matchingRemotes)) append(remote, snapshot?.remoteBranches.filter(b => b.remote === remote).map(b => ({ id: `remote:${b.name}`, label: b.branch, kind: 'remote-branch', ref: b.name })) ?? [], 1, true, 'remotes'.includes(query) ? '' : query)
    }
    append('Tags', tags.map(name => ({ id: `tag:${name}`, label: name, kind: 'tag', ref: name })))
    append('Stashes', snapshot?.stashes.map(s => ({ id: s.sha, label: s.label, kind: 'stash', ref: s.sha, selector: s.selector })) ?? [])
    append('Submodules', submodules.map(path => ({ id: `module:${path}`, label: path, kind: 'submodule', path })))
    return rows
  }, [snapshot, worktrees, collapsed, sidebarFilter, tags, submodules])
  useEffect(() => {
    let live = true
    void Promise.all([browseWorktrees(root), git(root, ['for-each-ref', '--format=%(refname:strip=2)', 'refs/tags']), git(root, ['ls-files', '--stage', '-z'])]).then(([trees, tagNames, staged]) => {
      if (!live) return
      setWorktrees(trees); setTags(tagNames.trimEnd().split('\n').filter(Boolean)); setSubmodules([...new Set(staged.split('\0').filter(record => record.startsWith('160000 ')).map(record => record.slice(record.indexOf('\t') + 1)))])
    }).catch(e => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [root, refresh, snapshot?.workflowRevision])
  useEffect(() => { setNavCursor(index => Math.min(index, navigation.length - 1)) }, [navigation.length])
  useEffect(() => {
    if (!historyVisible) return
    let live = true
    setLoading(true); setError('')
    const key = JSON.stringify([root, historyRef, refresh, snapshot?.workflowRevision])
    const cached = loadedHistory.current.key === key ? loadedHistory.current : { key, commits: [], exhausted: false }
    void (async () => {
      let commits = cached.commits, exhausted = cached.exhausted
      while (commits.length < historyLimit && !exhausted) {
        const next = await browseHistory(root, historyRef, commits.length)
        if (!live) return
        commits = [...commits, ...next]; exhausted = next.length < 100
      }
      if (live) {
        loadedHistory.current = { key, commits, exhausted }
        setHistory(commits); setHasMore(!exhausted); setSelectedCommit(old => old ?? commits[0] ?? null)
      }
    })().catch(e => { if (live) { setHistory([]); setError(String(e)) } }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [root, historyRef, historyVisible, historyLimit, refresh, snapshot?.workflowRevision])
  const detailStep = useRef(0)
  const request = useRef(0)
  const selectCommit = useCallback((commit: BrowseCommit) => { detailStep.current = 0; request.current++; setSelectedCommit(commit); setFilePath(undefined); setRange(null); setError('') }, [])
  const activate = useCallback((item: Navigation) => {
    if (childBusy || workspace.busy) return
    detailStep.current = 0; request.current++
    if (item.kind === 'group') { setCollapsed(old => { const next = new Set(old); if (GROUPS.includes(item.id)) { if (next.has(item.id)) next.delete(item.id); else next.add(item.id) } else { const openKey = `open:${item.id}`; if (next.has(openKey)) next.delete(openKey); else next.add(openKey) }; return next }); return }
    if (item.kind === 'submodule') {
      const token = request.current
      void git(`${root}/${item.path}`, ['rev-parse', '--show-toplevel']).then(path => { if (token === request.current) { if (path.trimEnd() === root) setError('Submodule is not initialized.'); else switchRoot(path.trimEnd()) } }).catch(() => { if (token === request.current) setError('Submodule is not initialized.') })
      return
    }
    if (item.kind === 'worktree') { switchRoot(item.path!); return }
    setSelection(item); setNavigationOpen(false); setTab('Changes'); setRange(null); setRangeAnchor(null); setHistoryCursor(0); setHistoryTop(0); historyScroll.current?.scrollTo(0); setHistoryLimit(100)
    if (item.kind === 'local') { setHistoryVisible(false); setHistoryOnly(false); setRegion('detail'); return }
    if (item.kind === 'stash') {
      setHistoryVisible(false); setSelectedCommit(null); setRegion('detail')
      const token = request.current
      void browseCommit(root, item.ref!).then(c => { if (token === request.current) selectCommit(c) }).catch(e => { if (token === request.current) setError(String(e)) })
      return
    }
    setSelectedCommit(null); setHistory([]); setHistoryVisible(true); setHistoryOnly(true); setRegion('history')
  }, [root, selectCommit, switchRoot, childBusy, workspace.busy])
  const parent = useCallback((sha: string) => {
    const token = ++request.current
    void browseCommit(root, sha).then(commit => { if (token === request.current) { setSelection({ id: 'history', kind: 'history', label: 'All Commits' }); selectCommit(commit); setTab('Commit') } }).catch(e => { if (token === request.current) setError(String(e)) })
  }, [root, selectCommit])
  const source: DiffSourceSelection = range ? { kind: 'commit-range', ...range } : !isLocal && selectedCommit ? { kind: 'commit-range', base: selectedCommit.parents[0] ?? EMPTY_TREE, head: selectedCommit.sha } : { kind: 'working' }
  const sourceKey = JSON.stringify(source)
  const openActions = useCallback(() => {
    if (!snapshot || childBusy || workspace.busy) return
    const context: WorkflowContext = selection.kind === 'branch' || selection.kind === 'remote-branch' ? { kind: selection.kind, ref: selection.ref! } : selection.kind === 'stash' ? { kind: 'stash', ref: selection.ref!, selector: selection.selector } : !isLocal && selectedCommit ? { kind: 'commit', ref: selectedCommit.sha } : null
    setMenu({ snapshot, context })
  }, [snapshot, selection, isLocal, selectedCommit, childBusy, workspace.busy])
  const registerChild = useCallback((handler: (key: GitKeyEvent) => boolean | void) => { childKey.current = handler }, [])
  const captureChild = useCallback((capture: boolean) => setChildCapture(capture), [])
  const closeChild = useCallback(() => { setRegion('tabs') }, [])
  const switchToReview = useCallback(() => { setStaging(false); setTab('Changes') }, [])
  const changeTab = useCallback((next: DetailTab) => { if (childBusy || workspace.busy) return; setTab(next); setRegion('detail'); setHistoryOnly(false); setChildCapture(false) }, [childBusy, workspace.busy])
  const toggleHistory = useCallback(() => { setHistoryVisible(value => !value); setHistoryOnly(true); setRegion(historyVisible ? 'tabs' : 'history') }, [historyVisible])
  const onKey = useCallback((key: GitKeyEvent) => {
    if (menu) return menuKey.current(key)
    if (childBusy || workspace.busy) return
    if (filterEditing) {
      if (key.name === 'escape') { setSidebarFilter(''); setFilterEditing(false); return }
      if (key.name === 'return' || key.name === 'tab' || key.name === 'down') { setFilterEditing(false); setNavCursor(Math.min(2, navigation.length - 1)); setRegion('navigation'); return }
      return false
    }
    if (region === 'navigation' && key.sequence === '/') { setFilterEditing(true); return }
    if (childCapture && showDetail) return childKey.current(key)
    if (key.ctrl && key.name === 'n') { setNavigationOpen(v => !v); setRegion(navigationOpen ? 'tabs' : 'navigation'); return }
    if (key.sequence === ':') { if (region === 'detail' && isLocal && (staging || tab === 'Commit') && childKey.current(key) !== false) return; openActions(); return }
    if (key.ctrl && key.name === 'h') { toggleHistory(); return }
    if (key.ctrl && key.name === 'r') { void workspace.refresh(); setRefresh(v => v + 1); return }
    if (key.name === 'escape') { if (navigationOpen) { setNavigationOpen(false); setRegion('tabs') } else if (region === 'detail') { const handled = childKey.current(key); if (handled === false) setRegion('tabs') } else onClose(); return }
    if (key.name === 'tab') {
      if (region === 'detail' && tab !== 'Commit') {
        if (!key.shift && detailStep.current === 0 || key.shift && detailStep.current === 1) { detailStep.current = key.shift ? 0 : 1; return childKey.current(key) }
      }
      detailStep.current = 0
      const regions: Region[] = [...(!sidebarOverlay || navigationOpen ? ['navigation' as const] : []), ...(showHistory ? ['history' as const] : []), 'tabs', ...(showDetail ? ['detail' as const] : [])]
      setRegion(regions[(regions.indexOf(region) + (key.shift ? regions.length - 1 : 1)) % regions.length]!); return
    }
    if (key.sequence === 'g' && isLocal) { setStaging(true); setTab('Changes'); setRegion('detail'); return }
    if (key.sequence === 'G' && isLocal) { switchToReview(); return }
    if (key.sequence === 'c' && isLocal && region !== 'detail') { changeTab('Commit'); return }
    if (region === 'detail') return childKey.current(key)
    const delta = key.name === 'down' || key.sequence === 'j' ? 1 : key.name === 'up' || key.sequence === 'k' ? -1 : key.name === 'pagedown' ? 10 : key.name === 'pageup' ? -10 : 0
    if ((key.name === 'home' || key.name === 'end') && region === 'navigation') { setNavCursor(key.name === 'home' ? 0 : navigation.length - 1); return }
    if ((key.name === 'home' || key.name === 'end') && region === 'history') { setHistoryCursor(key.name === 'home' ? 0 : history.length - 1); return }
    if (region === 'tabs') {
      if (key.name === 'left' || key.name === 'right') { setTab(TABS[(TABS.indexOf(tab) + (key.name === 'left' ? 2 : 1)) % 3]!); setChildCapture(false) }
      if (key.name === 'return' || key.name === 'down') setRegion('detail')
    } else if (region === 'navigation') {
      if (delta) setNavCursor(i => Math.max(0, Math.min(navigation.length - 1, i + delta)))
      if (key.name === 'return' || key.name === 'left' || key.name === 'right') { const item = navigation[navCursor]; if (item) activate(item) }
    } else if (region === 'history') {
      if (delta) {
        if (key.shift && rangeAnchor === null) setRangeAnchor(historyCursor)
        const next = Math.max(0, Math.min(history.length, historyCursor + delta)); setHistoryCursor(next)
        if (history[next] && !key.shift) selectCommit(history[next]!)
      }
      if (key.name === 'return') {
        if (historyCursor === history.length && hasMore) setHistoryLimit(v => v + 100)
        else if (rangeAnchor !== null && history[historyCursor]) {
          setRange({ base: history[Math.max(rangeAnchor, historyCursor)]!.parents[0] ?? EMPTY_TREE, head: history[Math.min(rangeAnchor, historyCursor)]!.sha }); setRangeAnchor(null); setHistoryOnly(false); setRegion('detail'); setTab('Changes')
        } else if (history[historyCursor]) { selectCommit(history[historyCursor]!); setHistoryOnly(false); setRegion('detail') }
      }
    }
  }, [menu, toggleHistory, childBusy, workspace.busy, childCapture, showDetail, filterEditing, openActions, workspace.refresh, navigationOpen, region, onClose, sidebarOverlay, showHistory, isLocal, staging, switchToReview, changeTab, tab, navigation, navCursor, activate, rangeAnchor, historyCursor, history, selectCommit, hasMore])
  useEffect(() => { if (active) props.onKeyHandlerReady(onKey) }, [active, onKey, props.onKeyHandlerReady])
  useLayoutEffect(() => { if (active) props.onKeyCaptureChange?.(Boolean(menu || childCapture || navigationOpen || filterEditing)); return () => { if (active) props.onKeyCaptureChange?.(false) } }, [active, menu, childCapture, navigationOpen, filterEditing, region, props.onKeyCaptureChange])
  useEffect(() => { historyScroll.current?.scrollTo(Math.max(0, historyCursor - historyH + 3)) }, [historyCursor, historyH])
  useEffect(() => { navScroll.current?.scrollTo(Math.max(0, navCursor - bodyH + 7)) }, [navCursor, bodyH])
  useEffect(() => {
    const bar = historyScroll.current?.verticalScrollBar
    if (!bar || !showHistory || !active) return
    const changed = ({ position }: { position: number }) => setHistoryTop(Math.floor(position))
    bar.on('change', changed)
    return () => { bar.off('change', changed) }
  }, [showHistory, active])
  const historyStart = Math.max(0, historyTop - 3)
  const historyEnd = Math.min(history.length, historyStart + historyH + 8)
  const title = isLocal ? 'Local Changes' : range ? `${range.base.slice(0, 7)}..${range.head.slice(0, 7)}` : selectedCommit ? `${selectedCommit.sha.slice(0, 7)} ${selectedCommit.subject}` : selection.label
  const navigationWidth = sidebarOverlay ? Math.min(38, popW - 2) : navW
  const navigationPanel = <GitSidebar theme={theme} width={navigationWidth} height={bodyH} repository={root.split('/').pop() ?? root} rows={navigation} cursor={navCursor} selection={selection.id} focused={region === 'navigation'} visible={active && (!sidebarOverlay || navigationOpen)} filter={sidebarFilter} filtering={filterEditing} scrollRef={navScroll} onResize={value => setSidebarWidth(Math.max(22, Math.min(value, Math.floor(popW * .45), popW - 60)))}
    onCollapse={() => { setFilterEditing(false); setNavigationOpen(false); if (!sidebarOverlay) setSidebarHidden(true); setRegion('tabs') }}
    onChoose={index => { setFilterEditing(false); setNavCursor(index); setRegion('navigation'); activate(navigation[index]!) }} onFilter={value => { setSidebarFilter(value); setNavCursor(2) }} onEdit={() => { setRegion('navigation'); setFilterEditing(true) }} />
  const repoSummary = `[Repo] ${safeLabel(snapshot?.branch ?? 'Loading…')} ↑${snapshot?.ahead ?? 0} ↓${snapshot?.behind ?? 0}${narrow ? '' : ` · ${safeLabel(root.split('/').pop() ?? root)}${snapshot?.upstream ? ` → ${safeLabel(snapshot.upstream)}` : ' · no upstream'}`}`
  const sidebarControl = narrow ? '[≡] ' : sidebarHidden ? '[▶ Sidebar] ' : '[◀] '
  const repoSummaryWidth = Math.max(1, popW - (docked ? 0 : 2) - 2 - 22 - sidebarControl.length - (snapshot?.operation ? 16 : 0))
  // OpenTUI infers a border from borderColor even with border=false; [] explicitly disables it.
  return <box position={docked ? undefined : 'absolute'} top={docked ? undefined : 1} left={docked ? undefined : 1} width={popW} height={popH} overflow="hidden" border={docked ? [] : true} borderColor={theme.border2} backgroundColor={theme.surface} flexDirection="column" title={docked ? undefined : ' Git '} zIndex={props.zIndex ?? 50}>
    {!docked && props.onDetach ? <PopoverDetachButton theme={theme} onPress={props.onDetach} /> : null}
    <box height={1} flexShrink={0} flexDirection="row" paddingX={1}>
      <box id="git-sidebar-toggle" flexShrink={0} onMouseDown={() => { setFilterEditing(false); if (narrow) { setNavigationOpen(value => !value); setRegion('navigation') } else { setSidebarHidden(value => !value); setNavigationOpen(false); if (region === 'navigation') setRegion('tabs') } }}><text fg={theme.cyan} wrapMode="none">{sidebarControl}</text></box>
      <box width={repoSummaryWidth} flexShrink={0} overflow="hidden" onMouseDown={() => { setNavigationOpen(v => !v); setRegion('navigation') }}><text fg={theme.cyan} wrapMode="none">{fitLabel(repoSummary, repoSummaryWidth - 1)} </text></box>
      <box flexShrink={0} onMouseDown={toggleHistory}><text fg={theme.cyan}>[History] </text></box>
      <box flexShrink={0} onMouseDown={openActions}><text fg={theme.cyan}>[: Actions]</text></box>
      {snapshot?.operation ? <text fg={theme.amber} wrapMode="none">{fitLabel(` ${snapshot.operation}`, 16)}</text> : null}
    </box>
    <box height={bodyH} flexShrink={0} minHeight={0} flexDirection="row" overflow="hidden">
      {!sidebarOverlay ? navigationPanel : null}
      <box width={contentW} flexShrink={0} minWidth={0} flexDirection="column" overflow="hidden">
        {showHistory ? <box height={historyH} flexShrink={0} flexDirection="column" onMouseDown={() => setRegion('history')}>
          <box id="git-history-header" height={1} width={contentW} flexShrink={0} overflow="hidden"><text fg={theme.muted} wrapMode="none">{`${selection.kind === 'branch' || selection.kind === 'remote-branch' ? selection.label : 'All Commits'} · subject / author / SHA / date${loading ? ' · Loading…' : ''}`}</text></box>
          <scrollbox id="git-history-scroll" ref={historyScroll} height={Math.max(1, historyH - 2 - (short ? 1 : 0))} width={contentW} flexShrink={0} minHeight={0} scrollY scrollX={false}><box height={historyStart} flexShrink={0} />{history.slice(historyStart, historyEnd).map((commit, offset) => { const index = historyStart + offset; return <box key={commit.sha} width={contentW - 1} height={1} flexShrink={0} overflow="hidden" backgroundColor={index === historyCursor ? theme.surface3 : undefined} onMouseDown={e => { e.stopPropagation(); setRegion('history'); setHistoryCursor(index); selectCommit(commit); setHistoryOnly(false) }}>
            <text fg={commit.sha === selectedCommit?.sha ? theme.cyan : theme.text} wrapMode="none">{contentW < 85
              ? safeLabel(`${commit.graph ?? '●'} ${commit.sha.slice(0, 7)} ${commit.subject}`)
              : `${safeLabel(`${commit.graph ?? '●'} ${commit.refs ? `[${fitLabel(commit.refs, 24)}] ` : ''}${commit.subject}`).slice(0, Math.max(12, contentW - 42)).padEnd(Math.max(12, contentW - 42))} ${safeLabel(commit.author).slice(0, 17).padEnd(17)} ${commit.sha.slice(0, 7)} ${commit.date.slice(0, 10)}`}</text>
          </box>})}<box height={Math.max(0, history.length - historyEnd)} flexShrink={0} />{hasMore ? <box height={1} onMouseDown={() => setHistoryLimit(v => v + 100)}><text fg={theme.cyan}>Load 100 more…</text></box> : null}{!history.length && !loading ? <text fg={theme.dim}>No commits.</text> : null}</scrollbox>
          {short ? <box height={1} onMouseDown={() => { setHistoryOnly(false); setRegion('tabs') }}><text fg={theme.cyan}>[Enter / click: details]</text></box> : null}
          {short ? <box height={1} flexShrink={0}><text fg={theme.border} wrapMode="none">{'─'.repeat(contentW)}</text></box> : <GitDivider id="git-history-divider" vertical={false} width={contentW} height={1} size={historyH} theme={theme} onResize={value => setHistoryRows(Math.max(5, Math.min(value, bodyH - 10)))} />}
        </box> : null}
        <box visible={showDetail} width={contentW} height={showDetail ? bodyH - (showHistory ? historyH : 0) : 0} flexShrink={0} minHeight={0} flexDirection="column" overflow="hidden">
          <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.surface2} onMouseDown={() => setRegion('tabs')}>
            {TABS.map(value => <box key={value} paddingX={1} backgroundColor={tab === value ? theme.surface3 : undefined} onMouseDown={e => { e.stopPropagation(); changeTab(value) }}><text fg={tab === value ? theme.cyan : theme.muted}>{value}</text></box>)}
            {isLocal && tab === 'Changes' ? <box onMouseDown={() => { setStaging(v => !v); setRegion('detail') }}><text fg={theme.cyan}>{staging ? '[G Annotated review]' : '[g Stage changes]'}</text></box> : null}
          </box>
          <box height={1} flexShrink={0}><text fg={theme.muted} wrapMode="none">{safeLabel(title)}</text></box>
          <box width={contentW} height={detailH} flexShrink={0} minHeight={0} overflow="hidden" flexDirection="column" onMouseDown={() => setRegion('detail')}>
            <DetailPanel active={active && showDetail && tab === 'Changes' && !(isLocal && staging)} width={contentW} height={detailH} register={registerChild} capture={captureChild}>
              {(register, capture) => isLocal || selectedCommit ? <GitReviewPopover key={sourceKey} {...props} cwd={root} embedded docked width={contentW} height={detailH} initialSource={source} initialFilePath={filePath} refreshRevision={snapshot?.revision} onWorkspace={isLocal ? () => setStaging(true) : undefined} onClose={closeChild} onDetach={undefined} onKeyHandlerReady={register} onKeyCaptureChange={capture} /> : <CommitDetails cwd={root} commit={null} theme={theme} height={detailH} registerKeys={register} onParent={parent} onFile={() => {}} />}
            </DetailPanel>
            {isLocal ? <DetailPanel active={active && showDetail && (tab === 'Commit' || tab === 'Changes' && staging)} width={contentW} height={detailH} register={registerChild} capture={captureChild}>
              {(register, capture) => <GitWorkspace {...props} cwd={root} embedded docked width={contentW} height={detailH} startCompose={tab === 'Commit'} onRepositoryChange={workspace.refresh} onBusyChange={setChildBusy} refreshRevision={snapshot?.revision} onReview={switchToReview} onClose={closeChild} onDetach={undefined} onKeyHandlerReady={register} onKeyCaptureChange={capture} />}
            </DetailPanel> : <DetailPanel active={active && showDetail && tab === 'Commit'} width={contentW} height={detailH} register={registerChild} capture={captureChild}>
              {register => <CommitDetails cwd={root} commit={selectedCommit} theme={theme} height={detailH} registerKeys={register} onParent={parent} onFile={path => { setFilePath(path); changeTab('Changes') }} />}
            </DetailPanel>}
            <DetailPanel active={active && showDetail && tab === 'File Tree'} width={contentW} height={detailH} register={registerChild} capture={captureChild}>
              {register => <RevisionTree key={isLocal ? 'local' : selectedCommit?.sha ?? 'none'} cwd={root} revision={isLocal ? null : selectedCommit?.sha} refreshRevision={isLocal ? snapshot?.revision : undefined} theme={theme} width={contentW} height={detailH} registerKeys={register} />}
            </DetailPanel>

          </box>
        </box>
      </box>
    </box>
    <box height={1} flexShrink={0}><text fg={error || workspace.error ? theme.red : workspace.busy ? theme.amber : theme.dim} wrapMode="none">{error || workspace.error || (workspace.busy ? 'Git operation running…' : workspace.output || `Ctrl+N navigation · Ctrl+H history · Tab regions · : actions · Ctrl+R refresh · Esc back/close`)}</text></box>
    {sidebarOverlay && navigationOpen ? <box position="absolute" top={1} left={0} zIndex={10}>{navigationPanel}</box> : null}
    {menu ? <GitWorkflowMenu snapshot={menu.snapshot} context={menu.context} path={null} theme={theme} width={popW} height={popH} busy={workspace.busy} error={workspace.error} onRun={async (action, revision) => { const result = await workspace.workflow(action, revision); if (result) setRefresh(v => v + 1); return result }} onClose={() => setMenu(null)} onKeyHandlerReady={handler => { menuKey.current = handler }} /> : null}
  </box>
}


/** Retain tab state while suspending hidden review subscriptions and key routing. */
function DetailPanel({ active, width, height, register, capture, children }: {
  active: boolean; width: number; height: number; register: GitPopoverProps['onKeyHandlerReady']; capture: (value: boolean) => void
  children: (register: GitPopoverProps['onKeyHandlerReady'], capture: (value: boolean) => void) => React.ReactNode
}) {
  const [visited, setVisited] = useState(active)
  const handler = useRef<(key: GitKeyEvent) => boolean | void>(() => false)
  const [capturing, setCapturing] = useState(false)
  const ready = useCallback((next: (key: GitKeyEvent) => boolean | void) => { handler.current = next }, [])
  const route = useCallback((key: GitKeyEvent) => handler.current(key), [])
  useEffect(() => { if (active) setVisited(true) }, [active])
  useEffect(() => { if (active) register(route) }, [active, register, route])
  useEffect(() => { if (active) capture(capturing) }, [active, capture, capturing])
  return visited ? <box visible={active} position="absolute" top={0} left={0} width={width} height={height}><RetainedWindow visible={active}>{children(ready, setCapturing)}</RetainedWindow></box> : null
}
