/** @jsxImportSource @opentui/react */
// Agent control-center smoke: mounts CoordinationPopover against a temp data
// dir, then against a seeded ledger, asserting the fleet, work-board, agent,
// activity, prompt, and keyboard surfaces render together. Hermetic — the coordination DB
// resolves from process.cwd(), so chdir BEFORE importing anything that opens it.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const smokeRoot = mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-smoke-'))
const smokeRepo = path.join(smokeRoot, 'main')
const agentWorktreePath = path.join(smokeRoot, 'agent-worktree')
mkdirSync(smokeRepo)
execFileSync('git', ['init', '-q'], { cwd: smokeRepo })
writeFileSync(path.join(smokeRepo, 'agent-change.txt'), 'baseline\n')
execFileSync('git', ['add', '.'], { cwd: smokeRepo })
execFileSync('git', ['-c', 'user.name=Agent Viewer', '-c', 'user.email=agent-viewer@example.invalid', 'commit', '-qm', 'baseline'], { cwd: smokeRepo })
execFileSync('git', ['worktree', 'add', '-q', '-b', 'agent/x', agentWorktreePath], { cwd: smokeRepo })
writeFileSync(path.join(agentWorktreePath, 'agent-change.txt'), 'changed by nova\n')
execFileSync('git', ['add', '.'], { cwd: agentWorktreePath })
execFileSync('git', ['-c', 'user.name=Agent Viewer', '-c', 'user.email=agent-viewer@example.invalid', 'commit', '-qm', 'agent committed change'], { cwd: agentWorktreePath })
writeFileSync(path.join(agentWorktreePath, 'agent-change.txt'), 'changed again by nova\n')
process.chdir(smokeRepo)

const { CoordinationPopover } = await import('./CoordinationPopover')
const { listTuiProtocolRuns, readTuiProtocolRun } = await import('../../lib/tui/service')
const { LIGHT_THEME } = await import('../theme')

// Force schema creation, then seed a run directly.
await listTuiProtocolRuns()
// eval-indirected like agentCoordination's own opener: `bun:sqlite` has no
// type declarations under tsconfig.opentui, and the bundler must not see it.
const { Database } = await (0, eval)('import("bun:sqlite")') as { Database: new (file: string) => any }
const db = new Database(path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination', 'coordination.sqlite'))
const ts = new Date().toISOString()
const oldTs = new Date(Date.now() - 60_000).toISOString()
db.exec(`INSERT INTO protocol_runs (id, prompt, status, provider, base_cwd, max_agents, lead_agent_id, created_at, updated_at)
  VALUES ('run-smoke', 'smoke the board', 'running', 'claude', '${process.cwd()}', 3, 'lead', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_runs (id, prompt, status, provider, base_cwd, max_agents, lead_agent_id, created_at, updated_at)
  VALUES ('run-codex', 'finished provider audit', 'completed', 'codex', '${process.cwd()}', 2, 'codex-lead', '${oldTs}', '${oldTs}')`)
db.exec(`INSERT INTO protocol_agents (id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, status, created_at, updated_at)
  VALUES ('lead', 'run-smoke', 'lead', 'lead', 'claude', 'sess-lead', '${process.cwd()}', '', 'idle', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_agents (id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, status, created_at, updated_at)
  VALUES ('agent-1', 'run-smoke', 'nova', 'teammate', 'claude', 'sess-1', '${agentWorktreePath}', 'agent/x', 'working', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_agents (id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, status, created_at, updated_at)
  VALUES ('codex-lead', 'run-codex', 'codex-01', 'lead', 'codex', 'sess-codex', '${process.cwd()}', '', 'done', '${oldTs}', '${oldTs}')`)
db.exec(`INSERT INTO protocol_tasks (id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at)
  VALUES ('task-1', 'run-smoke', 'Build the widget', 'do it', 'in_progress', 'agent-1', '[]', '[]', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_tasks (id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at)
  VALUES ('task-0', 'run-smoke', 'Queue dependencies', 'queue it', 'pending', 'lead', '[]', '[]', '${oldTs}', '${oldTs}')`)
db.exec(`INSERT INTO protocol_tasks (id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at)
  VALUES ('task-2', 'run-smoke', 'Verify output', 'verify it', 'completed', 'lead', '[]', '[]', '${oldTs}', '${ts}')`)
db.exec(`INSERT INTO protocol_tasks (id, run_id, title, prompt, status, owner_agent_id, paths_json, blocked_by_json, created_at, updated_at)
  VALUES ('task-3', 'run-smoke', 'Retry failed task', 'rerun it', 'failed', NULL, '[]', '[]', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_events (id, run_id, agent_id, type, summary, paths_json, timestamp, created_at)
  VALUES ('ev-1', 'run-smoke', 'agent-1', 'finding', 'widget lives in src/widget', '[]', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_messages (id, run_id, from_agent_id, to_agent_id, body, kind, priority, reply_required, created_at)
  VALUES ('msg-1', 'run-smoke', 'agent-1', 'lead', 'Supervision checkpoint: cc-transcript blocked, last update 2026-07-25T04:20:02Z. Review current status; leave healthy work running.', 'request', 'urgent', 1, '${ts}')`)
db.exec(`INSERT INTO protocol_messages (id, run_id, from_agent_id, to_agent_id, body, kind, priority, reply_required, created_at, delivered_at)
  VALUES ('msg-2', 'run-smoke', 'lead', 'agent-1', 'review approved', 'response', 'normal', 0, '${ts}', '${ts}')`)
for (let index = 2; index <= 12; index += 1) {
  const eventTs = new Date(Date.now() + index * 1000).toISOString()
  const eventType = index >= 11 ? 'message' : 'finding'
  const eventAgent = index === 11 ? 'lead' : 'agent-1'
  // ev-12 carries a long summary so the DETAIL body must wrap: at the old
  // height the second line overlapped the header and its glyphs bled through.
  const summary = index === 11
    ? 'review approved'
    : index === 12
      ? 'Supervision checkpoint: cc-transcript blocked, last update 2026-07-25T04:20:02Z. Review current status; leave healthy work running.'
      : `activity event ${index}`
  db.exec(`INSERT INTO protocol_events (id, run_id, agent_id, type, summary, paths_json, timestamp, created_at)
    VALUES ('ev-${index}', 'run-smoke', '${eventAgent}', '${eventType}', '${summary}', '[]', '${eventTs}', '${eventTs}')`)
}
db.close()

const noop = () => {}
let openedSessionAgent: string | null = null
let newRunRequests = 0
let handleKey: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
const smokeWidth = Number.parseInt(process.env.AGENT_VIEWER_COORD_SMOKE_WIDTH ?? '120', 10)
const smokeHeight = Number.parseInt(process.env.AGENT_VIEWER_COORD_SMOKE_HEIGHT ?? '40', 10)
const { captureCharFrame, captureSpans, mockMouse } = await testRender(
  <CoordinationPopover
    theme={LIGHT_THEME}
    width={smokeWidth}
    height={smokeHeight}
    initialRunId={null}
    onOpenSession={(agent) => { openedSessionAgent = agent.name }}
    onNewRun={() => { newRunRequests += 1 }}
    onClose={noop}
    onNotice={noop}
    onKeyHandlerReady={(handler) => { handleKey = handler }}
  />,
  { width: smokeWidth, height: smokeHeight },
)

// The popover discovers the run list and polls the snapshot asynchronously —
// poll the frame until everything renders (bounded), rather than racing a
// fixed sleep against SQLite + effect timing.
const MARKERS = [
  'AGENT CONTROL CENTER',
  'WORKFLOWS',
  'WORK BOARD',
  'AGENT INSPECTOR',
  'LIVE ACTIVITY',
  'TOPOLOGY',
  'nova→le',
  'lead→no',
  // Inspector mail rows are column-aligned, so the counterparty is padded out to
  // a fixed width before the kind — assert the parts, not one spacing-sensitive
  // string that breaks on every column tweak.
  '→ lead',
  'request ?',
  '2 workflows',
  '3 agents',
  'finished provide',
  'CODEX',
  'smoke the board',
  'Queue dependen',
  'Build the widget',
  'Verify output',
  'Retry failed task',
  '[R] rerun failed/blocked',
  'G changes',
  ...(smokeWidth >= 160 ? ['STAGE    TASK', '└─ [ ]', 'THROUGHPUT (events/min)', 'RUN STATE', 'OWNERSHIP'] : []),
]
let missing: string[] = MARKERS
const deadline = Date.now() + 10_000
while (Date.now() < deadline) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
  const frame = captureCharFrame()
  missing = MARKERS.filter((marker) => !frame.includes(marker))
  if (missing.length === 0) break
}
if (missing.length > 0) {
  // Explicit exit: the popover's poll interval would otherwise keep the
  // process alive long after the failure.
  console.error(`Coordination board frame missing: ${missing.join(', ')}\n${captureCharFrame()}`)
  process.exit(1)
}

// A DETAIL body long enough to wrap must not evict or overlap its header. When
// the region was one row too short the header disappeared and its coloured
// glyphs bled through the body ("SupervisionGcheckpoint"), so assert the header
// survives AND both wrapped lines render with their spaces intact.
{
  const frame = captureCharFrame()
  if (!frame.includes('DETAIL · MSG')) {
    console.error(`DETAIL header was evicted by a wrapping body:\n${frame}`)
    process.exit(1)
  }
  if (!frame.includes('Supervision checkpoint:') || !frame.includes('cc-transcript blocked, last')) {
    console.error(`DETAIL body did not wrap cleanly across its rows:\n${frame}`)
    process.exit(1)
  }
}

const frame = captureCharFrame()
if (process.env.AGENT_VIEWER_COORD_SMOKE_FRAME === '1') console.log(frame)
if (!frame.includes('nova') || !frame.includes('finding') || !frame.includes('1 focus')) {
  console.error('Agent control center did not render agent, activity, and keyboard controls together')
  process.exit(1)
}

const spanBackground = (marker: string): string | null => {
  for (const line of captureSpans().lines) {
    const span = line.spans.find((entry) => entry.text.includes(marker))
    if (span) return span.bg.toString()
  }
  return null
}

const overviewFocusBackground = spanBackground('[1] WORKFLOWS')
const inactiveTaskBackground = spanBackground('[2] WORK BOARD')
if (!overviewFocusBackground || !inactiveTaskBackground || overviewFocusBackground === inactiveTaskBackground) {
  console.error('Initial workflow focus is not visually distinct from inactive panes')
  process.exit(1)
}

const waitForFrameMarker = async (marker: string, timeoutMs = 2_000): Promise<boolean> => {
  const markerDeadline = Date.now() + timeoutMs
  while (Date.now() < markerDeadline) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    if (captureCharFrame().includes(marker)) return true
  }
  return false
}

// The keyboard handler remains active for pane focus even though all panes are
// visible at once. Exercise tab and numeric focus without changing geometry.
await act(async () => {
  handleKey?.({ name: 'tab', ctrl: false, shift: false, sequence: '\t' })
  handleKey?.({ name: '2', ctrl: false, shift: false, sequence: '2' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (spanBackground('[1] WORKFLOWS') !== inactiveTaskBackground || spanBackground('[2] WORK BOARD') !== overviewFocusBackground) {
  console.error('Task focus did not move the active-pane highlight from workflows to the work board')
  process.exit(1)
}
let navigationFrame = captureCharFrame()
const queuedAt = navigationFrame.indexOf('Queue dependen')
const activeAt = navigationFrame.indexOf('Build the widget')
const verifyAt = navigationFrame.indexOf('Verify output')
if (queuedAt < 0 || activeAt <= queuedAt || verifyAt <= activeAt || !navigationFrame.includes('Agent:    lead')) {
  console.error('Task navigation order does not match the queued, active, verify visual order')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
navigationFrame = captureCharFrame()
if (!navigationFrame.includes('Agent:    nova')) {
  console.error('Down navigation did not move from the queued task to the active task')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'up', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('Agent:    lead')) {
  console.error('Up navigation did not return from the active task to the queued task')
  process.exit(1)
}

// The global prompt row advertises rerun while Workflow pane 1 is focused,
// and Shift+R from that exact state jumps to the failed task confirmation.
await act(async () => {
  handleKey?.({ name: '1', ctrl: false, shift: false, sequence: '1' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
await act(async () => {
  handleKey?.({ name: 'r', ctrl: false, shift: true, sequence: 'R' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('Rerun task-3')) {
  console.error('Global failed-task hint was visible but Shift+R did not open rerun confirmation')
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
await act(async () => {
  handleKey?.({ name: '2', ctrl: false, shift: false, sequence: '2' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})

// Failed and blocked tasks can be rerun directly from the work board, even
// when their previous owner is gone. Shift+R confirms, then task.released
// returns the task to the pending claim queue.
await act(async () => {
  handleKey?.({ name: '/', ctrl: false, shift: false, sequence: '/' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('R rerun')) {
  console.error(`Failed task selection did not expose the rerun hotkey hint in the footer\n${captureCharFrame()}`)
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: 'r', ctrl: false, shift: true, sequence: 'R' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('Rerun task-3')) {
  console.error('Failed task rerun hotkey did not open confirmation')
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' })
  await new Promise((resolve) => setTimeout(resolve, 100))
})
const rerunSnapshot = await readTuiProtocolRun('run-smoke')
if (rerunSnapshot?.tasks.find((entry) => entry.id === 'task-3')?.status !== 'pending') {
  console.error('Confirmed task rerun did not return the failed task to pending')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'tab', ctrl: false, shift: true, sequence: '\t' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('WORK BOARD')) {
  console.error('Shift-Tab focus navigation changed dashboard geometry')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '' })
})
if (!await waitForFrameMarker('WORK BOARD  finished')) {
  console.error('Workflow down navigation did not follow the visible grouped order')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'up', ctrl: false, shift: false, sequence: '' })
})
if (!await waitForFrameMarker('WORK BOARD  smoke')) {
  console.error('Workflow up navigation did not return to the previous visible workflow')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: '3', ctrl: false, shift: false, sequence: '3' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('[1/2]')) {
  console.error('Agent pane did not start at the first visible agent')
  process.exit(1)
}
if (spanBackground('[3] AGENT INSPECTOR') !== overviewFocusBackground || !captureCharFrame().includes('[3 TEAM]')) {
  console.error('Agent focus did not highlight the inspector and expose its contextual hotkeys')
  process.exit(1)
}

// Git review follows the currently inspected agent. The lead uses the clean
// shared checkout, while nova's isolated worktree contains the only diff.
await act(async () => {
  handleKey?.({ name: 'g', ctrl: false, shift: true, sequence: 'G' })
})
if (!await waitForFrameMarker('Git · lead · shared checkout')) {
  console.error('Lead Git review did not open against the shared checkout')
  process.exit(1)
}
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
if (captureCharFrame().includes('M agent-change.txt')) {
  console.error('Lead Git review leaked changes from nova’s isolated worktree')
  process.exit(1)
}
if (captureCharFrame().includes('agent committed change')) {
  console.error('Lead Git history leaked commits from nova’s isolated branch')
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '' })
})
if (!await waitForFrameMarker('[3] AGENT INSPECTOR')) {
  console.error('Closing lead Git review did not return to the Coordinator')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'down', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('[2/2]')) {
  console.error('Agent down navigation did not advance one visible agent')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'g', ctrl: false, shift: true, sequence: 'G' })
})
if (!await waitForFrameMarker('Git · nova · agent/x') || !await waitForFrameMarker('M agent-change.txt')) {
  console.error(`Nova Git review did not use the agent worktree:\n${captureCharFrame()}`)
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: '4', ctrl: false, shift: false, sequence: '4' })
})
if (!await waitForFrameMarker('agent committed change')) {
  console.error('Nova Git review did not expose commits from the agent branch')
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '' })
})
if (!await waitForFrameMarker('[2/2]')) {
  console.error('Closing worktree Git review did not preserve the selected agent')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: '4', ctrl: false, shift: false, sequence: '4' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('13/13')) {
  console.error('Activity pane did not start at the live tail')
  process.exit(1)
}
if (spanBackground('[4] LIVE ACTIVITY') !== overviewFocusBackground || !captureCharFrame().includes('[4 EVENTS]')) {
  console.error('Activity focus did not highlight live activity and expose its contextual hotkeys')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'm', ctrl: false, shift: false, sequence: 'm' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('> nova:')) {
  console.error('Activity message hotkey did not target the selected event agent')
  process.exit(1)
}

await act(async () => {
  for (const char of 'hi') handleKey?.({ name: char, ctrl: false, shift: false, sequence: char })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('> nova: hi')) {
  console.error('Typing into the message composer did not update the draft')
  process.exit(1)
}
await act(async () => {
  handleKey?.({ name: 'backspace', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('> nova: h') || captureCharFrame().includes('> nova: hi')) {
  console.error('Backspace did not remove the last character from the message draft')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'escape', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})

await act(async () => {
  handleKey?.({ name: 'up', ctrl: false, shift: false, sequence: '' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('12/13')) {
  console.error('Activity up navigation did not keep the selected event in view')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'return', ctrl: false, shift: false, sequence: '\r' })
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (openedSessionAgent !== 'lead') {
  console.error('Activity inspect hotkey did not open the selected event agent session')
  process.exit(1)
}

await act(async () => {
  handleKey?.({ name: 'n', ctrl: false, shift: false, sequence: 'n' })
})
if (newRunRequests !== 1) {
  console.error('N did not open the new workflow launcher from Agent Operations')
  process.exit(1)
}

// Mouse navigation: the panes are reachable with a pointer, not only 1-4/tab.
// Locate a pane by its header row in the rendered frame so the assertion does
// not hard-code a layout that shifts whenever a pane is resized.
function findCell(needle: string): { x: number; y: number } | null {
  const lines = captureCharFrame().split('\n')
  for (let y = 0; y < lines.length; y += 1) {
    const x = lines[y]?.indexOf(needle) ?? -1
    if (x >= 0) return { x, y }
  }
  return null
}

const workBoardHeader = findCell('[2] WORK BOARD')
const inspectorHeader = findCell('[3] AGENT INSPECTOR')
if (!workBoardHeader || !inspectorHeader) {
  console.error('Could not locate pane headers for the mouse navigation check')
  process.exit(1)
}

// Focus starts on the activity pane (the keyboard walk above left it there).
await act(async () => {
  await mockMouse.click(workBoardHeader.x + 2, workBoardHeader.y)
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('j/k task')) {
  console.error(`Clicking the work board did not focus it:\n${captureCharFrame()}`)
  process.exit(1)
}

await act(async () => {
  await mockMouse.click(inspectorHeader.x + 2, inspectorHeader.y)
  await new Promise((resolve) => setTimeout(resolve, 50))
})
if (!captureCharFrame().includes('j/k agent')) {
  console.error(`Clicking the agent inspector did not focus it:\n${captureCharFrame()}`)
  process.exit(1)
}

console.log('Agent control center smoke passed')
process.exit(0)
