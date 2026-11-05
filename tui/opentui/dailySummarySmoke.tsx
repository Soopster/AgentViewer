/** @jsxImportSource @opentui/react */
// The daily summary, against a real index and a real repository.
//
// A summary is read as a record of what happened, so each defect here is a
// false statement that looks plausible: a tool result counted as a prompt, a
// colleague's commit counted as the user's, a removed temp checkout ranked
// above the real project, or a waiting approval filed under no repository.
import React from 'react'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { buildDailySummary, dailySummaryBounds, formatDailySummaryMarkdown } from '../../lib/dailySummary'
import type { SessionMessage } from '../../lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ── Bounds ──────────────────────────────────────────────────────────────────
{
  const wednesday = new Date(2026, 9, 14, 15, 0)
  const week = dailySummaryBounds('week', wednesday)
  assert(new Date(week.fromMs).getDate() === 12 && new Date(week.fromMs).getHours() === 0, 'a week starts on Monday at midnight')
  const sunday = dailySummaryBounds('week', new Date(2026, 9, 18, 9, 0))
  assert(new Date(sunday.fromMs).getDate() === 12, 'Sunday still belongs to the week that began on Monday')
  const yesterday = dailySummaryBounds('yesterday', wednesday)
  assert(new Date(yesterday.fromMs).getDate() === 13 && yesterday.toMs === new Date(2026, 9, 14).getTime() - 1, 'yesterday ends where today begins')
  console.log('Today, yesterday and this week are local, and a week starts on Monday.')
}

// ── Grouping ────────────────────────────────────────────────────────────────
{
  const bounds = { fromMs: 1000, toMs: 9000, label: 'Today' }
  const summary = buildDailySummary({
    range: 'today',
    bounds,
    sessions: [
      { key: 'claude:a', provider: 'claude', sessionId: 'a', title: 'Login', cwd: '/r/app', firstPrompt: null, firstMessageAt: 500, lastMessageAt: 5000, lastModified: 5000 },
      { key: 'codex:b', provider: 'codex', sessionId: 'b', title: 'Temp run', cwd: '/tmp/gone', firstPrompt: 'probe', firstMessageAt: 2000, lastMessageAt: 3000, lastModified: 3000 },
      { key: 'claude:c', provider: 'claude', sessionId: 'c', title: 'Unread', cwd: '/r/app', firstPrompt: null, firstMessageAt: 100, lastMessageAt: 200, lastModified: 4000 },
      { key: 'claude:d', provider: 'claude', sessionId: 'd', title: 'Only browsed', cwd: '/r/app', firstPrompt: null, firstMessageAt: 100, lastMessageAt: 4000, lastModified: 4000 },
    ],
    prompts: [{ sessionKey: 'claude:a', timestampMs: 2000, text: 'add login' }],
    edits: [
      { sessionKey: 'claude:a', timestampMs: 2100, filePath: '/r/app/src/login.ts', prompt: 'add login' },
      // An edit from before is_prompt existed still names its turn's prompt.
      { sessionKey: 'claude:a', timestampMs: 2200, filePath: '/r/app/src/auth.ts', prompt: 'wire auth' },
    ],
    repoRoots: new Map([['/r/app', '/r/app'], ['/tmp/gone', '/tmp/gone']]),
    repos: [
      { root: '/r/app', exists: true, commits: [{ sha: 'abcdef1234', subject: 'Add login', author: 'me', timestampMs: 3000 }], pullRequests: [{ number: 7, title: 'Login', state: 'OPEN', url: 'https://x/7', isDraft: false, reviewDecision: 'CHANGES_REQUESTED' }], dirtyFiles: 2 },
      { root: '/tmp/gone', exists: false, commits: [], pullRequests: [], dirtyFiles: null },
    ],
    waiting: [
      { provider: 'claude', sessionId: 'a', kind: 'permission', text: 'Bash: rm -rf build' },
      { provider: 'pi', sessionId: 'zzz', kind: 'question', text: 'Which port?' },
    ],
  })
  // Outside-a-repository still holds live work (a waiting question); a gone checkout is history.
  const [app, outside, gone] = summary.repos
  assert(app?.name === 'app' && outside?.root === '' && gone?.name === 'gone', `order: ${summary.repos.map((repo) => repo.name).join(', ')}`)
  const login = app.sessions.find((session) => session.sessionId === 'a')!
  assert(login.prompts.join('|') === 'add login|wire auth', `prompts: ${login.prompts.join('|')}`)
  assert(login.files.join() === 'src/auth.ts,src/login.ts', `files are repo-relative: ${login.files.join()}`)
  assert(app.sessions.some((session) => session.sessionId === 'c' && session.unindexed), 'a session whose store moved past its index is flagged')
  assert(!app.sessions.some((session) => session.sessionId === 'd'), 'a session that did nothing in range is left out')
  assert(gone.sessions[0]?.prompts[0] === 'probe', 'a session that started in range falls back to its first prompt')
  const waiting = app.waiting.map((item) => item.text)
  assert(waiting.includes('approval: Bash: rm -rf build') && waiting.includes('2 uncommitted files') && waiting.includes('#7 changes requested: Login'), `waiting: ${waiting.join(' | ')}`)
  assert(outside.waiting[0]?.text === 'question: Which port?', 'a waiting item with no session in range is still reported')
  assert(summary.unindexedSessions === 1 && summary.totals.commits === 1, 'totals')
  const markdown = formatDailySummaryMarkdown(summary)
  assert(markdown.startsWith('# Today\n') && markdown.includes('## gone (no longer on disk)') && markdown.includes('- abcdef1 Add login'), `markdown:\n${markdown}`)
  console.log('Sessions, files, commits and waiting items land under their repository; a gone checkout sorts last.')
}

// ── Against a real index and repository ────────────────────────────────────
const workspace = await realpath(await mkdtemp(join(tmpdir(), 'agent-viewer-daily-summary-')))
const previousCwd = process.cwd()
try {
  const repo = join(workspace, 'app')
  await mkdir(join(repo, 'src'), { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'me@example.com')
  git('config', 'user.name', 'Me')
  await writeFile(join(repo, 'README.md'), 'hi\n')
  git('add', '-A')
  git('commit', '-qm', 'Mine today')
  await writeFile(join(repo, 'other.txt'), 'x\n')
  git('add', '-A')
  git('-c', 'user.email=colleague@example.com', '-c', 'user.name=Colleague', 'commit', '-qm', 'Not mine')
  await writeFile(join(repo, 'src', 'login.ts'), 'export {}\n')

  // The index lives under the cwd, so it must be chosen before the module loads.
  process.chdir(workspace)
  const { syncPersistedSessions, syncPersistedSessionMessages } = await import('../../lib/sessionPersistence')
  const { readDailySummary } = await import('../../lib/dailySummaryReader')
  const { DailySummaryPopover } = await import('./DailySummaryPopover')
  const now = Date.now()
  const at = (offsetMs: number) => new Date(now - offsetMs).toISOString()
  const message = (uuid: string, type: 'user' | 'assistant', content: unknown, offsetMs: number): SessionMessage => ({
    type, uuid, session_id: 'sess-a', parent_tool_use_id: null, timestamp: at(offsetMs),
    message: { role: type, content } as SessionMessage['message'],
  })
  await syncPersistedSessions([{ sessionId: 'sess-a', provider: 'claude', cwd: repo, summary: 'Login work', lastModified: now - 1000 }])
  await syncPersistedSessionMessages('claude', 'sess-a', [
    message('u1', 'user', 'add a login page', 60_000),
    message('a1', 'assistant', [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: join(repo, 'src', 'login.ts'), content: 'export {}\n' } }], 50_000),
    // A tool result is a user-role row, and must not read as a prompt.
    message('u2', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'File created' }], 40_000),
    message('a2', 'assistant', [{ type: 'text', text: 'Done.' }], 30_000),
  ])

  const summary = await readDailySummary({
    range: 'today',
    skipPullRequests: true,
    waiting: [{ provider: 'claude', sessionId: 'sess-a', kind: 'permission', text: 'Bash: npm publish' }],
  })
  const app = summary.repos.find((entry) => entry.root === repo)
  assert(app, `no repository entry for ${repo}: ${JSON.stringify(summary.repos.map((entry) => entry.root))}`)
  const session = app.sessions[0]!
  assert(session.prompts.join('|') === 'add a login page', `prompts read from the index: ${session.prompts.join('|')}`)
  assert(session.files.join() === 'src/login.ts', `files: ${session.files.join()}`)
  assert(app.commits.length === 1 && app.commits[0]!.subject === 'Mine today', `commits: ${JSON.stringify(app.commits)}`)
  assert(app.waiting.some((item) => item.text === 'approval: Bash: npm publish') && app.waiting.some((item) => item.text === '1 uncommitted file'), `waiting: ${JSON.stringify(app.waiting)}`)
  console.log('A real day: the prompt, not its tool result; my commit, not a colleague\'s; the approval and the dirty tree.')

  // ── The popover ──────────────────────────────────────────────────────────
  let handleKey: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
  const copies: string[] = []
  const setup = await testRender(
    <DailySummaryPopover
      theme={DARK_THEME}
      accentColor={DARK_THEME.cyan}
      width={110}
      height={36}
      waiting={[]}
      skipPullRequests
      onClose={() => {}}
      onNotice={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onCopy={(text) => { copies.push(text) }}
    />,
    { width: 110, height: 36 },
  )
  const settle = async (ms: number) => {
    const deadline = performance.now() + ms
    while (performance.now() < deadline) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  const until = async (predicate: () => boolean, what: string) => {
    const deadline = performance.now() + 8000
    while (performance.now() < deadline && !predicate()) await settle(50)
    assert(predicate(), `${what}:\n${setup.captureCharFrame()}`)
  }
  const press = async (sequence: string) => {
    act(() => { handleKey?.({ name: sequence, ctrl: false, shift: false, sequence }) })
    await settle(100)
  }
  try {
    await until(() => setup.captureCharFrame().includes('"add a login page"'), 'today\'s summary did not render')
    assert(setup.captureCharFrame().includes('● today'), 'today is not the selected range')
    await press('c')
    assert(copies[0]?.startsWith('# Today') && copies[0].includes('- Login work (claude · 1 file)'), `copied:\n${copies[0]}`)
    await press('y')
    await until(() => setup.captureCharFrame().includes('● yesterday') && setup.captureCharFrame().includes('No recorded agent activity'), 'y did not switch to yesterday')
    console.log('The popover shows what it copies, and t/y/w switch the range.')
  } finally {
    act(() => setup.renderer.destroy())
  }
  console.log('Daily summary smoke passed')
} finally {
  process.chdir(previousCwd)
  await rm(workspace, { recursive: true, force: true })
}

