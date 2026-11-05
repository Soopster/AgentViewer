/** @jsxImportSource @opentui/react */
// GitHub in the terminal, without leaving the app: Overview · Inbox · PRs ·
// Issues · Actions · Releases · Security. List on the left, detail on the right
// (stacked under 100 columns). Reads and writes go through lib/tui/github.ts, so
// it works attached to a daemon too. The surface is `keys: 'capture'`: this
// component owns every key, which is what lets it take text (comments, titles)
// itself — see githubCompose.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitText, openExternalUrl, popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import * as gh from '../../../lib/tui/github'
import type {
  GithubInbox, GithubIssueDetail, GithubIssueSummary, GithubMergeMethod, GithubPrDetail, GithubPrFilters, GithubPrSummary, GithubRelease,
  GithubReleaseDetail, GithubRepoOverview, GithubRun, GithubRunDetail, GithubSecurity, GithubWorkflow,
} from '../../../lib/github/types'
import { applyComposeKey, composeView } from './githubCompose'
import {
  GITHUB_TABS, alertDetailLines, alertRows, inboxRows, issueDetailLines, issueRows, overviewLines, prDetailLines, prRows, releaseDetailLines,
  releaseRows, runDetailLines, runRows, type GithubRow, type GithubTab,
} from './githubRows'

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  cwd: string
  docked?: boolean
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string) => void
  onAskAgent: (prompt: string) => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
}

const SPLIT_MIN_WIDTH = 100
const MERGE_METHODS: GithubMergeMethod[] = ['squash', 'merge', 'rebase']
const PR_SCOPES: Array<NonNullable<GithubPrFilters['scope']>> = ['all', 'mine', 'review-requested', 'assigned']
const PR_STATES: Array<NonNullable<GithubPrFilters['state']>> = ['open', 'merged', 'closed', 'all']
const ISSUE_STATES = ['open', 'closed', 'all'] as const
const POLL_MS = 12_000
const DETAIL_DEBOUNCE_MS = 200
const cycle = <T,>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length]

type Pending = { prompt: string; choices: Record<string, () => Promise<string | void>> }
type Compose = { title: string; value: string; submit: (text: string) => void }
type Pick = { title: string; options: Array<{ label: string; value: string }>; index: number; onPick: (value: string) => void }

export function GitHubPopover({ theme, width, height, cwd, docked = false, onClose, onNotice, onAskAgent, onKeyHandlerReady }: Props) {
  const [tab, setTab] = useState<GithubTab>('overview')
  const [overview, setOverview] = useState<GithubRepoOverview | null>(null)
  const [inbox, setInbox] = useState<GithubInbox | null>(null)
  const [prs, setPrs] = useState<GithubPrSummary[]>([])
  const [issues, setIssues] = useState<GithubIssueSummary[]>([])
  const [runs, setRuns] = useState<GithubRun[]>([])
  const [releases, setReleases] = useState<GithubRelease[]>([])
  const [security, setSecurity] = useState<GithubSecurity | null>(null)
  const [prState, setPrState] = useState<NonNullable<GithubPrFilters['state']>>('open')
  const [prScope, setPrScope] = useState<NonNullable<GithubPrFilters['scope']>>('all')
  const [issueState, setIssueState] = useState<(typeof ISSUE_STATES)[number]>('open')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<{ key: string; lines: (w: number) => string[] } | null>(null)
  const [detailScroll, setDetailScroll] = useState(0)
  const [pending, setPending] = useState<Pending | null>(null)
  const [compose, setCompose] = useState<Compose | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  const [mergeMethod, setMergeMethod] = useState<GithubMergeMethod>('squash')
  const generation = useRef(0)
  const detailGeneration = useRef(0)
  /** The row the detail pane currently describes: a reload of the same row must not discard what was loaded onto it (the failed-step log). */
  const detailKeyRef = useRef<string | null>(null)
  const refs = useRef<{ pr: GithubPrDetail | null; issue: GithubIssueDetail | null; run: GithubRunDetail | null; release: GithubReleaseDetail | null; log: { text: string; truncated: boolean } | null }>({ pr: null, issue: null, run: null, release: null, log: null })

  const split = width >= SPLIT_MIN_WIDTH
  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 150)
  const popH = docked ? height : Math.min(height - 4, 38)
  const innerW = Math.max(popW - frame - 2, 30)
  const listW = split ? Math.floor(innerW * 0.45) : innerW
  const detailW = split ? innerW - listW - 1 : innerW
  const bodyRows = Math.max(popH - frame - 5, 3)

  const rows: GithubRow[] = useMemo(() => {
    switch (tab) {
      case 'inbox': return inbox ? inboxRows(inbox) : []
      case 'prs': return prRows(prs)
      case 'issues': return issueRows(issues)
      case 'actions': return runRows(runs)
      case 'releases': return releaseRows(releases)
      case 'security': return security ? alertRows(security) : []
      default: return []
    }
  }, [tab, inbox, prs, issues, runs, releases, security])
  const selected = rows[Math.min(cursor, Math.max(rows.length - 1, 0))] as GithubRow | undefined

  const load = useCallback(async (which: GithubTab) => {
    const mine = ++generation.current
    setLoading(true)
    try {
      switch (which) {
        case 'overview': { const value = await gh.readTuiGithubRepo(cwd); if (mine === generation.current) setOverview(value); break }
        case 'inbox': {
          const value = await gh.readTuiGithubInbox(cwd)
          if (mine === generation.current) { setInbox(value); if (!value.availability.ok) { setError(value.availability.message); return } }
          break
        }
        case 'prs': { const value = await gh.readTuiGithubPrs(cwd, { state: prState, scope: prScope }); if (mine === generation.current) setPrs(value); break }
        case 'issues': { const value = await gh.readTuiGithubIssues(cwd, { state: issueState }); if (mine === generation.current) setIssues(value); break }
        case 'actions': { const value = await gh.readTuiGithubRuns(cwd); if (mine === generation.current) setRuns(value.runs); break }
        case 'releases': { const value = await gh.readTuiGithubReleases(cwd); if (mine === generation.current) setReleases(value); break }
        case 'security': { const value = await gh.readTuiGithubSecurity(cwd); if (mine === generation.current) setSecurity(value); break }
      }
      if (mine === generation.current) setError(null)
    } catch (failure) {
      if (mine === generation.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [cwd, prState, prScope, issueState])

  useEffect(() => { setCursor(0); setDetail(null); detailKeyRef.current = null; setDetailOpen(false); setPending(null); setPick(null); void load(tab) }, [tab, load])

  // Poll runs only while one is in flight; the server caches 10s so this is one spawn per tick.
  const active = tab === 'actions' && runs.some(run => run.status !== 'completed')
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { void load('actions') }, POLL_MS)
    return () => clearInterval(timer)
  }, [active, load])

  const fail = useCallback((failure: unknown) => onNotice('error', failure instanceof Error ? failure.message : String(failure)), [onNotice])

  const openDetail = useCallback(async (row: GithubRow, quiet = false) => {
    const mine = ++detailGeneration.current
    if (detailKeyRef.current !== row.key) { setDetailScroll(0); refs.current.log = null }
    try {
      let next: { key: string; lines: (w: number) => string[] } | null = null
      if (tab === 'prs') { const pr = await gh.readTuiGithubPr(cwd, row.number); refs.current.pr = pr; next = { key: row.key, lines: w => prDetailLines(pr, w) } }
      else if (tab === 'issues') { const issue = await gh.readTuiGithubIssue(cwd, row.number); refs.current.issue = issue; next = { key: row.key, lines: w => issueDetailLines(issue, w) } }
      else if (tab === 'actions') { const run = await gh.readTuiGithubRun(cwd, row.id); refs.current.run = run; next = { key: row.key, lines: w => runDetailLines(run, w, refs.current.log) } }
      else if (tab === 'releases') { const release = await gh.readTuiGithubRelease(cwd, row.tag); refs.current.release = release; next = { key: row.key, lines: w => releaseDetailLines(release, w) } }
      else if (tab === 'security' && security) { const alert = security.alerts.find(entry => `a${entry.kind}${entry.number}` === row.key); next = { key: row.key, lines: w => alertDetailLines(alert, security, w) } }
      else next = { key: row.key, lines: () => [row.label, row.meta, row.url] }
      if (mine === detailGeneration.current) { detailKeyRef.current = row.key; setDetail(next); if (!quiet) setDetailOpen(true) }
    } catch (failure) {
      if (!quiet) fail(failure)
    }
  }, [cwd, tab, security, fail])

  // In the split layout the detail follows the cursor, so a list is browsable like a master/detail view.
  const selectedKey = selected?.key
  useEffect(() => {
    if (!split || !selected || tab === 'overview' || detailKeyRef.current === selected.key) return
    const timer = setTimeout(() => { void openDetail(selected, true) }, DETAIL_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `selected` is derived from rows+cursor; its key is the identity that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, tab, selectedKey])

  const run = useCallback(async (work: Promise<string | void>, done: string) => {
    try {
      const url = await work
      onNotice('info', url ? `${done} ${url}` : done)
      await load(tab)
      if (selected && ['prs', 'issues', 'actions', 'releases'].includes(tab)) void openDetail(selected, true)
    } catch (failure) { fail(failure) }
  }, [load, tab, selected, openDetail, onNotice, fail])

  const ask = useCallback((prompt: string, choices: Pending['choices']) => setPending({ prompt, choices }), [])
  const confirm = useCallback((prompt: string, work: () => Promise<string | void>, done: string) => ask(`${prompt} y/n`, { y: () => work().then(value => { onNotice('info', value ? `${done} ${value}` : done) }) }), [ask, onNotice])
  const startCompose = useCallback((title: string, submit: (text: string) => void) => setCompose({ title, value: '', submit }), [])

  const prState$ = refs.current.pr?.number === selected?.number ? refs.current.pr?.state : undefined

  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    const ch = key.sequence
    if (compose) {
      const result = applyComposeKey(compose.value, key)
      if (result.kind === 'edit') setCompose({ ...compose, value: result.value })
      else if (result.kind === 'cancel') setCompose(null)
      else if (result.kind === 'submit') { const { submit, value } = compose; setCompose(null); if (value.trim()) submit(value) }
      return
    }
    if (pick) {
      if (key.name === 'escape') setPick(null)
      else if (key.name === 'down' || ch === 'j') setPick({ ...pick, index: Math.min(pick.index + 1, pick.options.length - 1) })
      else if (key.name === 'up' || ch === 'k') setPick({ ...pick, index: Math.max(pick.index - 1, 0) })
      else if (key.name === 'return') { const chosen = pick.options[pick.index]; setPick(null); if (chosen) pick.onPick(chosen.value) }
      return
    }
    if (pending) {
      const choice = pending.choices[ch]
      setPending(null)
      if (choice) void run(choice(), 'Done')
      return
    }
    if (key.name === 'escape') {
      if (detailOpen && !split) setDetailOpen(false)
      else if (detailOpen) { setDetailOpen(false); setDetail(null) }
      else onClose()
      return
    }
    const tabIndex = ['1', '2', '3', '4', '5', '6', '7'].indexOf(ch)
    if (tabIndex >= 0) { setTab(GITHUB_TABS[tabIndex].id); return }
    if (key.name === 'tab') { setTab(GITHUB_TABS[(GITHUB_TABS.findIndex(entry => entry.id === tab) + (key.shift ? GITHUB_TABS.length - 1 : 1)) % GITHUB_TABS.length].id); return }
    if (ch === '[' || ch === ']' || (detailOpen && !split && ['j', 'k', 'down', 'up'].includes(key.name))) {
      setDetailScroll(value => Math.max(0, value + (ch === '[' || key.name === 'k' || key.name === 'up' ? -3 : 3)))
      return
    }
    if (key.name === 'down' || key.name === 'j') { setCursor(value => Math.min(value + 1, Math.max(rows.length - 1, 0))); return }
    if (key.name === 'up' || key.name === 'k') { setCursor(value => Math.max(value - 1, 0)); return }
    if (ch === 'f') { void load(tab); return }

    // Tab-wide actions that need no selection.
    if (tab === 'prs') {
      if (ch === 't') { setPrScope(cycle(PR_SCOPES, prScope)); return }
      if (ch === 'e') { setPrState(cycle(PR_STATES, prState)); return }
      if (ch === 's') { setMergeMethod(cycle(MERGE_METHODS, mergeMethod)); return }
      if (ch === 'n') {
        startCompose('New pull request from this branch — title', title => confirm(`Push and open "${title.split('\n')[0]}"?`, () => gh.runTuiGithubPrAction(cwd, { action: 'create', title: title.split('\n')[0] }), 'Created'))
        return
      }
    }
    if (tab === 'issues') {
      if (ch === 'e') { setIssueState(cycle(ISSUE_STATES, issueState)); return }
      if (ch === 'n') {
        startCompose('New issue — title', title => startCompose('New issue — description (enter to create, empty skips)', body => void run(gh.mutateTuiGithubIssue(cwd, { action: 'create', title: title.split('\n')[0], body }), 'Created')))
        return
      }
    }
    if (tab === 'releases' && ch === 'n') {
      startCompose('New release — tag (created if missing)', tag => ask(`Release ${tag.trim()} with generated notes: y publish · d draft · n cancel`, {
        y: () => gh.createTuiGithubRelease(cwd, { tag: tag.trim() }),
        d: () => gh.createTuiGithubRelease(cwd, { tag: tag.trim(), draft: true }),
      }))
      return
    }
    if (tab === 'inbox' && ch === 'X') { confirm('Mark every notification read?', () => gh.markTuiGithubNotifications(cwd, { all: true }), 'Marked all read'); return }
    if (tab === 'actions' && ch === 'w') {
      void gh.readTuiGithubWorkflows(cwd).then((workflows: GithubWorkflow[]) => {
        const options = workflows.filter(entry => entry.state === 'active').map(entry => ({ label: `${entry.name}  ${entry.path}`, value: String(entry.id) }))
        if (!options.length) { onNotice('info', 'No active workflows'); return }
        setPick({ title: 'Run workflow (workflow_dispatch) on the current branch', options, index: 0, onPick: id => confirm(`Run workflow ${options.find(entry => entry.value === id)?.label.split('  ')[0]}?`, () => gh.dispatchTuiGithubWorkflow(cwd, { workflow: id }), 'Dispatched') })
      }).catch(fail)
      return
    }
    if (tab === 'overview') {
      if (ch === 'o' && overview?.url) void openExternalUrl(overview.url)
      return
    }
    if (!selected) return
    if (key.name === 'return') { void openDetail(selected); return }
    if (ch === 'o' && selected.url) { void openExternalUrl(selected.url); return }

    if (ch === 'a') {
      const { pr, issue, log } = refs.current
      if (tab === 'issues' && issue?.number === selected.number) onAskAgent(`Work on issue #${selected.number}: ${selected.label}\n\n${issue.body}`)
      else if (tab === 'prs') onAskAgent(`Review pull request #${selected.number} (${selected.url}): ${selected.label}${pr?.number === selected.number ? `\n\n${pr.body.slice(0, 4000)}` : ''}`)
      else if (tab === 'actions') onAskAgent(`CI run "${selected.label}" failed (${selected.url}).${log ? `\n\nFailed-step log (tail):\n${log.text.slice(-6000)}` : ''}`)
      else if (tab === 'security') onAskAgent(`Fix this security alert: ${selected.label}\n${selected.meta}\n${selected.url}`)
      else onAskAgent(`Look at ${tab === 'issues' ? 'issue' : 'pull request'} #${selected.number} (${selected.url}): ${selected.label}`)
      return
    }

    if (tab === 'inbox' && ch === 'D' && selected.notification) {
      void run(gh.markTuiGithubNotifications(cwd, { id: selected.key.slice(1) }), 'Marked read')
    }
    if (tab === 'issues') {
      const open = refs.current.issue?.number === selected.number ? refs.current.issue.state === 'OPEN' : issueState !== 'closed'
      if (ch === 'c') startCompose(`Comment on #${selected.number}`, body => void run(gh.mutateTuiGithubIssue(cwd, { action: 'comment', number: selected.number, body }), 'Commented'))
      if (ch === 'x') confirm(`${open ? 'Close' : 'Reopen'} issue #${selected.number}?`, () => gh.mutateTuiGithubIssue(cwd, open ? { action: 'close', number: selected.number } : { action: 'reopen', number: selected.number }), open ? 'Closed' : 'Reopened')
      if (ch === 'i') confirm(`Assign #${selected.number} to you?`, () => gh.mutateTuiGithubIssue(cwd, { action: 'edit', number: selected.number, addAssignees: ['@me'] }), 'Assigned')
    }
    if (tab === 'actions') {
      if (ch === 'l') {
        void gh.readTuiGithubRunLog(cwd, selected.id).then((log) => {
          refs.current.log = log
          const runDetail = refs.current.run
          if (runDetail) setDetail({ key: selected.key, lines: w => runDetailLines(runDetail, w, log) })
          setDetailOpen(true); setDetailScroll(0)
        }).catch(fail)
      }
      if (ch === 'r') confirm(`Rerun failed jobs of "${selected.label}"?`, () => gh.actOnTuiGithubRun(cwd, selected.id, 'rerun-failed'), 'Rerun started')
      if (ch === 'A') confirm(`Rerun all jobs of "${selected.label}"?`, () => gh.actOnTuiGithubRun(cwd, selected.id, 'rerun-all'), 'Rerun started')
      if (ch === 'x') confirm(`Cancel run "${selected.label}"?`, () => gh.actOnTuiGithubRun(cwd, selected.id, 'cancel'), 'Cancel requested')
    }
    if (tab === 'prs') {
      const n = selected.number
      const act = (request: Parameters<typeof gh.runTuiGithubPrAction>[1]) => () => gh.runTuiGithubPrAction(cwd, request)
      if (ch === 'm') confirm(`Merge #${n} (${mergeMethod}, delete branch)?`, act({ action: 'merge', number: n, method: mergeMethod, deleteBranch: true }), 'Merged')
      if (ch === 'M') confirm(`Auto-merge #${n} (${mergeMethod}) when checks pass?`, act({ action: 'merge', number: n, method: mergeMethod, auto: true, deleteBranch: true }), 'Auto-merge set')
      if (ch === 'u') confirm(`Update #${n}'s branch from its base?`, act({ action: 'update-branch', number: n }), 'Branch updated')
      if (ch === 'd') confirm(`${selected.draft ? 'Mark #' + n + ' ready for review' : 'Convert #' + n + ' to draft'}?`, act({ action: 'ready', number: n, ready: selected.draft }), selected.draft ? 'Marked ready' : 'Marked draft')
      if (ch === 'k') confirm(`Check out #${n}?`, act({ action: 'checkout', number: n }), 'Checked out')
      if (ch === 'v') confirm(`Approve #${n}?`, act({ action: 'review', number: n, verdict: 'approve' }), 'Approved')
      if (ch === 'c') startCompose(`Comment on #${n}`, body => void run(gh.runTuiGithubPrAction(cwd, { action: 'comment', number: n, body }), 'Commented'))
      if (ch === 'R') startCompose(`Request changes on #${n}`, body => void run(gh.runTuiGithubPrAction(cwd, { action: 'review', number: n, verdict: 'request-changes', body }), 'Changes requested'))
      if (ch === 'x') {
        const open = (prState$ ?? (prState === 'open' || prState === 'all' ? 'OPEN' : 'CLOSED')) === 'OPEN'
        confirm(`${open ? 'Close' : 'Reopen'} #${n}?`, act({ action: open ? 'close' : 'reopen', number: n }), open ? 'Closed' : 'Reopened')
      }
      if (ch === 'r') {
        const thread = refs.current.pr?.number === n ? refs.current.pr.threads.find(entry => !entry.resolved) : undefined
        if (thread) confirm(`Resolve thread on ${thread.path}${thread.line ? ':' + thread.line : ''}?`, act({ action: 'thread', threadId: thread.id, resolved: true }), 'Resolved')
        else onNotice('info', 'No unresolved review threads (open the PR with enter first)')
      }
    }
  }, [compose, pick, pending, detailOpen, split, tab, rows.length, selected, cwd, mergeMethod, prScope, prState, issueState, overview, prState$, load, openDetail, run, ask, confirm, startCompose, onClose, onNotice, onAskAgent, fail])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const toneColor = (tone: GithubRow['tone']) => (tone === 'ok' ? theme.green : tone === 'bad' ? theme.red : tone === 'warn' ? theme.amber : theme.text)
  const start = Math.max(0, Math.min(cursor - Math.floor(bodyRows / 2), Math.max(rows.length - bodyRows, 0)))
  const visible = rows.slice(start, start + bodyRows)
  const detailLines = tab === 'overview' ? (overview ? overviewLines(overview) : []) : detail ? detail.lines(detailW) : []
  const filterNote = tab === 'prs' ? ` [${prState}/${prScope}]` : tab === 'issues' ? ` [${issueState}]` : ''
  const hints: Record<GithubTab, string> = {
    overview: 'o open on GitHub · f refresh · 1-7/tab · esc',
    inbox: 'enter detail · o open · a ask · D read · X read all · f refresh · esc',
    prs: `enter · v approve · c comment · R changes · m merge(${mergeMethod}) M auto · u update · d draft · k checkout · x close · r resolve · n new · t/e/s filter`,
    issues: 'enter · n new · c comment · x close/reopen · i assign me · e state · a ask · o open · esc',
    actions: 'enter jobs · l log · r rerun failed · A rerun all · x cancel · w run workflow · a ask · esc',
    releases: 'enter notes · n new release · o open · f refresh · esc',
    security: 'enter detail · a ask agent · o open · f refresh · esc',
  }
  const hint = pick ? 'enter choose · j/k · esc cancel' : compose ? 'enter submit · ⌃J newline · ⌃U clear line · esc cancel' : pending ? pending.prompt : hints[tab]

  const showList = tab !== 'overview' && !(detailOpen && !split)
  const showDetail = tab === 'overview' || detailOpen || split
  const empty = error ?? (loading && rows.length === 0 ? 'Loading…' : rows.length === 0 ? 'Nothing here.' : null)

  return (
    <box
      {...popoverRootProps(docked, { top: Math.floor((height - popH) / 2), left: Math.floor((width - popW) / 2), width: popW, height: popH }, 50)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' GitHub '}
      titleAlignment="left"
      paddingX={1}
    >
      <text wrapMode="none">
        {GITHUB_TABS.map((entry, index) => <span key={entry.id} fg={entry.id === tab ? theme.cyan : theme.muted}>{`${index + 1} ${entry.label}  `}</span>)}
        <span fg={theme.dim}>{`${filterNote}${loading ? ' …' : ''}`}</span>
      </text>
      <text fg={theme.dim} wrapMode="none">{'─'.repeat(innerW)}</text>
      {compose ? (
        <box flexDirection="column" height={bodyRows}>
          <text fg={theme.cyan} wrapMode="none">{fitText(compose.title, innerW)}</text>
          {composeView(compose.value, innerW, bodyRows - 1).map((line, index) => <text key={index} fg={theme.text} wrapMode="none">{fitText(line, innerW)}</text>)}
        </box>
      ) : pick ? (
        <box flexDirection="column" height={bodyRows}>
          <text fg={theme.cyan} wrapMode="none">{fitText(pick.title, innerW)}</text>
          {pick.options.slice(0, bodyRows - 1).map((option, index) => <text key={option.value} fg={index === pick.index ? theme.cyan : theme.text} wrapMode="none">{fitText(`${index === pick.index ? '▸' : ' '} ${option.label}`, innerW)}</text>)}
        </box>
      ) : (
        <box flexDirection="row" height={bodyRows}>
          {showList ? (
            <box flexDirection="column" width={listW}>
              {empty ? <text fg={error ? theme.red : theme.dim} wrapMode="none">{fitText(empty, listW)}</text> : visible.map((row, index) => {
                const isSel = start + index === Math.min(cursor, rows.length - 1)
                return <text key={row.key} fg={isSel ? theme.cyan : toneColor(row.tone)} wrapMode="none">{fitText(`${isSel ? '▸' : ' '} ${row.label}`, listW)}</text>
              })}
            </box>
          ) : null}
          {showDetail ? (
            <box flexDirection="column" width={detailW} paddingLeft={split && tab !== 'overview' ? 1 : 0}>
              {detailLines.length === 0
                ? <text fg={error && tab === 'overview' ? theme.red : theme.dim} wrapMode="none">{fitText(tab === 'overview' ? (error ?? (loading ? 'Loading…' : '')) : selected ? selected.meta : '', detailW)}</text>
                : detailLines.slice(detailScroll, detailScroll + bodyRows).map((line, index) => <text key={index} fg={theme.text} wrapMode="none">{fitText(line, detailW)}</text>)}
            </box>
          ) : null}
        </box>
      )}
      <box flexGrow={1} />
      <text fg={pending ? theme.amber : theme.dim} wrapMode="none">{fitText(hint, innerW)}</text>
    </box>
  )
}
