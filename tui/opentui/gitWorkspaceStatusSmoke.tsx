/** @jsxImportSource @opentui/react */
import React from 'react'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { GitReviewPopover as GitPopover } from './GitPopover'
import { fetchGitData } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import {
  describeStatusEntry, describeUpstream, fetchGitOperation, fetchGitWorkspaceStatus, formatGitWorkspaceStatus,
  isConflictEntry, parseBranchHeader, parseStatusEntries, parseWorktreeList, renameLabel, renameOriginLabel, siblingDisplayPath,
} from '../../lib/gitWorkspaceStatus'
import { DIFF_SCROLL_OFF, revealDiffScrollTop } from './gitDiffGeometry'

const execFileAsync = promisify(execFile)
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ── Pure parsing ────────────────────────────────────────────────────────────
const tracking = parseBranchHeader('## feature/x...origin/feature/x [ahead 3, behind 1]')
check(tracking.branch === 'feature/x' && tracking.upstream === 'origin/feature/x' && tracking.ahead === 3 && tracking.behind === 1, 'ahead/behind header misparsed')
check(describeUpstream(tracking) === '3 ahead · 1 behind origin/feature/x', `upstream text: ${describeUpstream(tracking)}`)
check(describeUpstream(parseBranchHeader('## main...origin/main [behind 2]')) === '2 behind origin/main', 'a zero counter must be omitted')
check(describeUpstream(parseBranchHeader('## main...origin/main')) === 'up to date with origin/main', 'aligned upstream misreported')
check(parseBranchHeader('## main...origin/main [gone]').upstreamGone, 'a deleted upstream must not read as aligned')
check(parseBranchHeader('## HEAD (no branch)').branch === null, 'detached HEAD read as a branch')
const unborn = parseBranchHeader('## No commits yet on main')
check(unborn.unborn && unborn.branch === 'main', 'unborn branch misparsed')
// A branch name may itself contain dots; only the `...` separator splits it.
check(parseBranchHeader('## release/1.2...origin/release/1.2').branch === 'release/1.2', 'dotted branch name split in the wrong place')

const renamed = parseStatusEntries(['## main', 'R  src/old.ts -> src/new.ts', ' M a -> b.txt', '?? note.md'])
check(renamed[0]!.path === 'src/new.ts' && renamed[0]!.previousPath === 'src/old.ts', 'rename origin lost')
// Only a rename or copy has an origin: ` -> ` is a legal part of any other file name.
check(renamed[1]!.path === 'a -> b.txt' && renamed[1]!.previousPath === undefined, 'a modified file named with an arrow was split as a rename')
check(renameLabel('src/old.ts', 'src/new.ts') === 'src/old.ts → new.ts', 'same-directory rename repeated its directory')
check(renameLabel('src/old.ts', 'lib/new.ts') === 'src/old.ts → lib/new.ts', 'a move must keep both full paths')
check(renameOriginLabel('src/old.ts', 'src/new.ts') === 'old.ts' && renameOriginLabel('src/old.ts', 'lib/new.ts') === 'src/old.ts', 'tree origin label wrong')

for (const pair of ['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']) check(isConflictEntry(pair[0]!, pair[1]!), `${pair} is unmerged`)
for (const pair of ['M ', ' M', 'A ', 'AM', 'D ', ' D', 'MM', '??']) check(!isConflictEntry(pair[0]!, pair[1]!), `${pair} is not unmerged`)
check(describeStatusEntry({ x: 'M', y: 'M' }) === 'modified (staged) · modified (unstaged)', 'mixed staging must show both sides')
check(describeStatusEntry({ x: 'A', y: ' ' }) === 'new file (staged)' && describeStatusEntry({ x: ' ', y: 'D' }) === 'deleted (unstaged)', 'single-side facts wrong')
check(describeStatusEntry({ x: 'D', y: 'D' }) === 'conflict (both deleted)', 'DD must read as a conflict, not a deletion')

const listed = parseWorktreeList('worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def\ndetached\nlocked reason\n\nworktree /gone\nHEAD 123\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n\nworktree /bare\nbare\n')
check(siblingDisplayPath('/src/repo', '/src/repo-wt') === '../repo-wt', 'a sibling beside the repository must read as relative')
check(siblingDisplayPath('/src/repo', '/src/repo/.worktrees/a') === '.worktrees/a', 'a nested worktree must read as relative')
check(siblingDisplayPath('/src/repo', '/var/tmp/elsewhere') === '/var/tmp/elsewhere', 'an unrelated worktree must keep its full path')
check(listed.length === 4 && listed[0]!.branch === 'main' && listed[1]!.branch === null && listed[1]!.state === 'locked'
  && listed[2]!.state === 'prunable' && listed[3]!.state === 'bare', `worktree list misparsed: ${JSON.stringify(listed)}`)

// ── Scroll-off ──────────────────────────────────────────────────────────────
check(revealDiffScrollTop(10, 1, 0, 30) === 0, 'a row with its margin must not move the viewport')
check(revealDiffScrollTop(27, 1, 0, 30) === 27 + 1 + DIFF_SCROLL_OFF - 30, 'stepping into the bottom margin must scroll before the edge')
check(revealDiffScrollTop(22, 1, 20, 30) === 22 - DIFF_SCROLL_OFF, 'stepping into the top margin must scroll before the edge')
check(revealDiffScrollTop(2, 1, 10, 30) === 0, 'the margin must not scroll above the first row')
// A margin wider than half the viewport would make a row unreachable.
check(revealDiffScrollTop(4, 1, 0, 5) === 2 && revealDiffScrollTop(2, 1, 0, 5) === 0, 'margin not clamped to half the viewport')
check(revealDiffScrollTop(8, 12, 0, 6) === 8, 'a row taller than the viewport must show its top')

// ── A real repository: conflict, rename, sibling worktrees ──────────────────
const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-viewer-git-status-')))
const cwd = join(root, 'repo')
const reviewDir = await mkdtemp(join(tmpdir(), 'agent-viewer-review-state-'))
process.env.AGENT_VIEWER_REVIEW_DIR = reviewDir
type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
let handleKey: ((key: Key) => void) | null = null
const press = (name: string, sequence = name): Key => ({ name, ctrl: false, shift: false, sequence })

let setup: Awaited<ReturnType<typeof testRender>> | null = null

async function flush(setup: Awaited<ReturnType<typeof testRender>>, delay = 300) {
  await act(async () => {
    await setup.flush()
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  })
  await setup.flush()
}

try {
  await execFileAsync('git', ['init', '-q', '-b', 'main', cwd])
  const git = (...args: string[]) => execFileAsync('git', args, { cwd })
  await git('config', 'user.email', 'agent-viewer@example.invalid')
  await git('config', 'user.name', 'Agent Viewer')
  await writeFile(join(cwd, 'shared.txt'), 'a\nb\nc\n')
  await writeFile(join(cwd, 'old-name.txt'), 'one\ntwo\nthree\nfour\n')
  await git('add', '.')
  await git('commit', '-qm', 'baseline')
  await git('checkout', '-qb', 'side')
  await writeFile(join(cwd, 'shared.txt'), 'a\nSIDE\nc\n')
  await git('commit', '-qam', 'side')
  await git('checkout', '-q', 'main')
  await writeFile(join(cwd, 'shared.txt'), 'a\nMAIN\nc\n')
  await git('commit', '-qam', 'main')

  check(await fetchGitOperation(cwd, runGitCommand) === null, 'an idle tree reported an operation')
  // Two siblings: one dirty, one whose directory is gone.
  await git('worktree', 'add', '-q', join(root, 'sibling'), '-b', 'sibling-work')
  await writeFile(join(root, 'sibling', 'fresh.txt'), 'new\n')
  await writeFile(join(root, 'sibling', 'shared.txt'), 'edited in sibling\n')
  await git('worktree', 'add', '-q', join(root, 'vanished'), '-b', 'vanished-work')
  await rm(join(root, 'vanished'), { recursive: true, force: true })

  // Git refuses to start a merge over a staged change, so the conflict comes first.
  await git('merge', 'side').catch(() => {})
  await rename(join(cwd, 'old-name.txt'), join(cwd, 'new-name.txt'))
  await git('add', '-A', '--', 'old-name.txt', 'new-name.txt')
  await writeFile(join(cwd, 'untracked.md'), 'draft\n')

  check(await fetchGitOperation(cwd, runGitCommand) === 'merge', 'a paused merge was not detected')
  const status = await fetchGitWorkspaceStatus(cwd, runGitCommand)
  check(status, 'no workspace status for a repository')
  check(status.branch === 'main' && status.operation === 'merge' && status.conflicts === 1, `current facts wrong: ${JSON.stringify(status)}`)
  check(status.tracked.some(entry => entry.path === 'new-name.txt' && entry.previousPath === 'old-name.txt'), 'rename origin missing from tracked changes')
  check(status.untracked.length === 1 && status.untracked[0]!.path === 'untracked.md', 'untracked group wrong')
  // The current worktree is not its own sibling.
  check(status.siblings.length === 2 && status.siblings.every(sibling => sibling.path !== cwd), `siblings wrong: ${JSON.stringify(status.siblings)}`)
  const dirty = status.siblings.find(sibling => sibling.branch === 'sibling-work')
  check(dirty && dirty.state === 'ok' && dirty.tracked === 1 && dirty.untracked === 1, `dirty sibling miscounted: ${JSON.stringify(dirty)}`)
  // A worktree that cannot be read must never be summarised as a clean one.
  const vanished = status.siblings.find(sibling => sibling.branch === 'vanished-work')
  check(vanished && vanished.state === 'prunable', `missing sibling reported as ${vanished?.state}`)

  const text = formatGitWorkspaceStatus(status)
  for (const expected of ['On main', 'merge in progress · 1 conflict', 'Tracked changes (2)', 'old-name.txt → new-name.txt  renamed (staged)',
    'shared.txt  conflict (both modified)', 'Untracked files (1)', 'Other worktrees (2)', 'sibling-work  1 changed · 1 untracked', 'vanished-work  missing (prunable)', '    ../sibling']) {
    check(text.includes(expected), `status text is missing "${expected}":\n${text}`)
  }
  // Both popovers colour this pane's lines by diff prefix.
  check(!text.split('\n').some(line => /^(\+|-|@@)/.test(line)), `a status line would be coloured as a diff line:\n${text}`)

  const data = await fetchGitData(cwd, runGitCommand)
  check(data.operation === 'merge', 'panel data does not carry the operation')
  check(data.status.some(entry => entry.previousPath === 'old-name.txt'), 'panel data lost the rename origin')

  // ── The popover itself ────────────────────────────────────────────────────
  setup = await testRender(
    <GitPopover cwd={cwd} theme={DARK_THEME} width={130} height={40} onClose={() => {}}
      onKeyHandlerReady={(handler) => { handleKey = handler }} />,
    { width: 130, height: 40 },
  )
  await flush(setup, 600)
  let frame = setup.captureCharFrame()
  check(frame.includes('merge in progress · 1 conflict'), `status box does not announce the paused merge:\n${frame}`)
  check(frame.includes('UU shared.txt'), `conflicted file lost its unmerged letters:\n${frame}`)
  check(frame.includes('new-name.txt ← old-name.txt'), `renamed file does not say where it came from:\n${frame}`)

  await act(async () => { handleKey?.(press('1')) })
  await flush(setup, 700)
  frame = setup.captureCharFrame()
  for (const expected of ['Tracked changes (2)', 'Other worktrees (2)', 'sibling-work']) {
    check(frame.includes(expected), `Status pane is missing "${expected}":\n${frame}`)
  }
  if (process.env.GIT_STATUS_SMOKE_FRAME) console.log(frame)
  console.log('git workspace status smoke: ok')
} finally {
  // A failed check must still exit: a live renderer keeps the process running.
  if (setup) await act(async () => { setup!.renderer.destroy() })
  await rm(root, { recursive: true, force: true })
  await rm(reviewDir, { recursive: true, force: true })
}
