/** @jsxImportSource @opentui/react */
// One file scrubbed through the turn checkpoints, against a real repository.
//
// Every defect here renders plausibly: a history that interleaves another
// worktree's snapshots shows diffs nobody made, an off-by-one interval pins a
// change on the wrong prompt, and a hunk reversed against lines rewritten since
// would silently mangle the file — so it must refuse instead.
import React from 'react'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { FileHistoryPopover, fileHistoryTimeline, hunkNewLineRange } from '../../plugins/file-history/tui/FileHistoryPopover'
import {
  CHECKPOINT_REF_PREFIX,
  createTurnCheckpoint,
  readFileCheckpointHistory,
  restoreCheckpoint,
  revertFileHistoryHunk,
} from '../../lib/checkpoints'
import type { SelectionAskInput } from '../../lib/selectionAsk'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const repo = await realpath(await mkdtemp(join(tmpdir(), 'agent-viewer-file-history-')))
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
const file = join(repo, 'a.txt')
const lines = (edits: Record<number, string> = {}) =>
  `${Array.from({ length: 12 }, (_, index) => edits[index + 1] ?? `l${index + 1}`).join('\n')}\n`
const pause = () => new Promise((resolve) => setTimeout(resolve, 15))

try {
  git('init', '-q')
  git('config', 'user.email', 'smoke@example.com')
  git('config', 'user.name', 'smoke')
  await writeFile(join(repo, 'other.txt'), 'untouched\n')
  await writeFile(file, lines())
  git('add', '-A')
  git('commit', '-qm', 'base')

  // Three turns: the first rewrites l2, the second l11, the third touches only
  // another file — then the working tree moves l6 and rewrites l11 again.
  const turn = async (message: string) => {
    const checkpoint = await createTurnCheckpoint(repo, { sessionId: `s-${message}`, provider: 'claude', message })
    assert(checkpoint, `no checkpoint for ${message}`)
    await pause()
    return checkpoint
  }
  const first = await turn('rename l2')
  await writeFile(file, lines({ 2: 'L2' }))
  const second = await turn('rename l11')
  await writeFile(file, lines({ 2: 'L2', 11: 'L11' }))
  await turn('edit another file')
  await writeFile(join(repo, 'other.txt'), 'touched\n')
  const fourth = await turn('move l6')
  await writeFile(file, lines({ 2: 'L2', 6: 'L6', 11: 'X11' }))

  // A snapshot from another worktree of the same repository: refs are shared,
  // so it is listed here too, and must not join this file's history.
  const foreignTree = git('mktree', '--missing')
  const foreign = git('commit-tree', foreignTree, '-m', `foreign\n\n${JSON.stringify({ provider: 'codex', worktree: '/elsewhere' })}`)
  git('update-ref', `${CHECKPOINT_REF_PREFIX}${Date.now()}-${foreign.slice(0, 8)}`, foreign)

  const history = await readFileCheckpointHistory(repo, 'a.txt')
  assert(history.checkpointsScanned === 4, `scanned ${history.checkpointsScanned} checkpoints; the foreign one must be skipped`)
  assert(history.steps.length === 3, `expected 3 steps (the other-file turn changed nothing here), got ${history.steps.length}`)
  const [stepOne, stepTwo, stepNow] = history.steps
  assert(stepOne!.checkpoint.ref === first.ref && stepOne!.until?.ref === second.ref, 'step 1 is not bounded by turns 1 and 2')
  assert(stepOne!.diff.includes('-l2') && stepOne!.diff.includes('+L2'), `step 1 diff wrong:\n${stepOne!.diff}`)
  assert(stepTwo!.diff.includes('+L11') && stepTwo!.until?.label === 'edit another file', 'step 2 must run to the next snapshot, even one that left this file alone')
  assert(stepNow!.checkpoint.ref === fourth.ref && stepNow!.until === null, 'the last step must run to the working tree')
  // l6 and l11 sit within one diff context of each other, so git joins them.
  assert(stepNow!.hunks.length === 1 &&stepNow!.additions === 2 && stepNow!.deletions === 2, `working-tree step: ${stepNow!.hunks.length} hunks +${stepNow!.additions} -${stepNow!.deletions}`)
  assert(hunkNewLineRange(stepOne!.hunks[0]!).startLine === 1, 'hunk range parse')
  console.log('A file\'s history is the intervals it changed in, bounded by the next snapshot, this worktree only.')

  const timeline = fileHistoryTimeline(history.steps, 1, 40).map((cell) => cell.text).join('')
  assert(timeline === '●─◆─●─ now', `timeline: ${JSON.stringify(timeline)}`)
  const narrow = fileHistoryTimeline(Array(30).fill(stepOne!), 29, 16)
  assert(narrow[0]!.text === '…' && narrow.some((cell) => cell.index === 29 && cell.text === '◆'), 'a windowed timeline keeps the selection')

  // Step 2's hunk names l11, which the working tree has rewritten since.
  let refused = ''
  try { await revertFileHistoryHunk(history.repoRoot, stepTwo!.hunks[0]!.patchText) } catch (err) { refused = (err as Error).message }
  assert(refused.includes('no longer applies'), `a stale hunk was not refused: ${refused || 'applied'}`)
  assert(await readFile(file, 'utf8') === lines({ 2: 'L2', 6: 'L6', 11: 'X11' }), 'a refused revert changed the file')
  console.log('A hunk whose lines were rewritten since is refused, not forced.')

  // ── The popover ──────────────────────────────────────────────────────────
  const asks: SelectionAskInput[] = []
  let handleKey: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
  const notices: string[] = []
  const setup = await testRender(
    <FileHistoryPopover
      cwd={repo}
      path="a.txt"
      theme={DARK_THEME}
      accentColor={DARK_THEME.cyan}
      width={110}
      height={32}
      onClose={() => {}}
      onNotice={(_, text) => { notices.push(text) }}
      onKeyHandlerReady={(handler) => { handleKey = handler }}
      onAskAgent={(request) => { asks.push(request) }}
    />,
    { width: 110, height: 32 },
  )
  const settle = async (durationMs: number) => {
    const deadline = performance.now() + durationMs
    while (performance.now() < deadline) {
      await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 10)) })
    }
  }
  const until = async (predicate: () => boolean, what: string) => {
    const deadline = performance.now() + 5000
    while (performance.now() < deadline && !predicate()) await settle(40)
    assert(predicate(), `${what}:\n${setup.captureCharFrame()}`)
  }
  const press = async (sequence: string, name = sequence) => {
    act(() => { handleKey?.({ name, ctrl: false, shift: sequence !== sequence.toLowerCase(), sequence }) })
    await settle(120)
  }

  try {
    await until(() => setup.captureCharFrame().includes('step 3/3'), 'the popover did not open on the newest step')
    assert(setup.captureCharFrame().includes('"move l6"') && setup.captureCharFrame().includes('until now'), 'newest step is not labelled by its turn')
    await press('h')
    await until(() => setup.captureCharFrame().includes('step 2/3') && setup.captureCharFrame().includes('"rename l11"'), 'h did not step back')

    await press('a')
    assert(setup.captureCharFrame().includes('w why'), 'a did not arm the ask menu')
    await press('w')
    assert(asks.length === 1, 'the ask was not sent')
    const ask = asks[0]!
    assert(ask.intent === 'why' && ask.isDiff && ask.filePath === 'a.txt', `ask: ${JSON.stringify(ask)}`)
    assert(ask.history?.[0]?.text === 'rename l11' && ask.code.includes('+L11'), 'the ask does not carry the step\'s prompt and hunk')
    console.log('A step is handed to an agent with the prompt that produced it.')

    // Undo step 1's change against the file as it is now: its lines are untouched since.
    await press('g')
    await until(() => setup.captureCharFrame().includes('step 1/3'), 'g did not go to the oldest step')
    await press('u')
    assert(setup.captureCharFrame().includes('Undo hunk 1'), 'u did not ask to confirm')
    await press('y')
    await until(() => notices.some((text) => text.startsWith('Reverted')), 'the revert did not report')
    assert(await readFile(file, 'utf8') === lines({ 6: 'L6', 11: 'X11' }), `revert produced:\n${await readFile(file, 'utf8')}`)
    console.log('An old step\'s hunk is undone in the file as it is now, leaving later work alone.')

    // Restore before the newest step: the file as the "move l6" turn found it.
    await press('G')
    await until(() => setup.captureCharFrame().includes('"move l6"'), 'G did not go to the newest step')
    await press('R')
    await press('y')
    await until(() => notices.some((text) => text.startsWith('Restored')), 'the restore did not report')
    assert(await readFile(file, 'utf8') === lines({ 2: 'L2', 11: 'L11' }), `restore produced:\n${await readFile(file, 'utf8')}`)
    assert(await readFile(join(repo, 'other.txt'), 'utf8') === 'touched\n', 'restoring one file touched another')
    console.log('R puts only this file back to how the step found it.')
  } finally {
    act(() => setup.renderer.destroy())
  }

  // restoreCheckpoint is what R runs; also check it alone leaves HEAD and the index be.
  await restoreCheckpoint(repo, first.sha, ['a.txt'])
  assert(git('diff', '--cached', '--name-only') === '', 'a restore staged something')
  console.log('File history smoke passed')
} finally {
  await rm(repo, { recursive: true, force: true })
}
