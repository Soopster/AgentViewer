/** @jsxImportSource @opentui/react */
// Coordination-board smoke: mounts CoordinationPopover against a temp data
// dir (empty state), then against a seeded ledger, asserting the team roster,
// task board, and event feed actually render. Hermetic — the coordination DB
// resolves from process.cwd(), so chdir BEFORE importing anything that opens it.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-coord-smoke-')))

const { CoordinationPopover } = await import('./CoordinationPopover')
const { listTuiProtocolRuns } = await import('../../lib/tui/service')
const { LIGHT_THEME } = await import('../theme')

// Force schema creation, then seed a run directly.
await listTuiProtocolRuns()
// eval-indirected like agentCoordination's own opener: `bun:sqlite` has no
// type declarations under tsconfig.opentui, and the bundler must not see it.
const { Database } = await (0, eval)('import("bun:sqlite")') as { Database: new (file: string) => any }
const db = new Database(path.join(process.cwd(), '.agent-viewer-data', 'agent-coordination', 'coordination.sqlite'))
const ts = new Date().toISOString()
db.exec(`INSERT INTO protocol_runs (id, prompt, status, provider, base_cwd, max_agents, lead_agent_id, created_at, updated_at)
  VALUES ('run-smoke', 'smoke the board', 'running', 'claude', '${process.cwd()}', 3, 'lead', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_agents (id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, status, created_at, updated_at)
  VALUES ('lead', 'run-smoke', 'lead', 'lead', 'claude', 'sess-lead', '${process.cwd()}', '', 'idle', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_agents (id, run_id, name, role, provider, session_id, worktree_path, worktree_branch, status, created_at, updated_at)
  VALUES ('agent-1', 'run-smoke', 'nova', 'teammate', 'claude', 'sess-1', '/tmp/wt-1', 'agent/x', 'working', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_tasks (id, run_id, title, prompt, status, paths_json, blocked_by_json, created_at, updated_at)
  VALUES ('task-1', 'run-smoke', 'Build the widget', 'do it', 'in_progress', '[]', '[]', '${ts}', '${ts}')`)
db.exec(`INSERT INTO protocol_events (id, run_id, agent_id, type, summary, paths_json, timestamp, created_at)
  VALUES ('ev-1', 'run-smoke', 'agent-1', 'finding', 'widget lives in src/widget', '[]', '${ts}', '${ts}')`)
db.close()

const noop = () => {}
const { captureCharFrame } = await testRender(
  <CoordinationPopover
    theme={LIGHT_THEME}
    width={120}
    height={40}
    initialRunId={null}
    onOpenSession={noop}
    onNewRun={noop}
    onClose={noop}
    onNotice={noop}
    onKeyHandlerReady={noop}
  />,
  { width: 120, height: 40 },
)

// The popover discovers the run list and polls the snapshot asynchronously —
// poll the frame until everything renders (bounded), rather than racing a
// fixed sleep against SQLite + effect timing.
const MARKERS = ['Agent team', 'RUNNING', 'nova', 'lead', 'task-1', 'finding']
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
  console.error(`Coordination board frame missing: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('Coordination board smoke passed')
process.exit(0)
