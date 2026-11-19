// The host's surface tables used to be hand-listed (titles, launcher letters,
// summaries, multi-window and full-screen kinds); they now come from each plugin
// manifest. These are the values the hand lists held, so a manifest edit that
// changes what the app shows has to change this file too.
import assert from 'node:assert/strict'
import { surfaceKindDescription, surfaceKindLabel, surfaceKindShortcut, isMultiInstanceSurface } from '../lib/rightPanel'
import { WINDOW_SURFACE_TITLES } from '../tui/opentui/windowSurfaceNames'
import { MULTI_INSTANCE_SURFACES, SURFACE_POPOVER_KINDS } from '../tui/opentui/app/layoutConstants'

const expected = {
  terminal: { title: '❯ Terminal', label: 'Terminal', shortcut: 'T', summary: 'Start a shell in this workspace.' },
  diff: { title: '± Diff', label: 'Diff', shortcut: 'D', summary: 'Review this repository’s changes.' },
  files: { title: '▤ Files', label: 'Files', shortcut: 'F', summary: 'Browse and read workspace files.' },
  browser: { title: '◍ Browser', label: 'Browser', shortcut: 'B', summary: 'Open a local app or URL.' },
  'pull-request': { title: '⑂ Pull request', label: 'Pull request', shortcut: 'P', summary: 'Open this branch’s pull request.' },
  agents: { title: '◆ Agents', label: 'Agents', shortcut: 'A', summary: 'Follow subagents and workflows.' },
} as const
for (const [kind, want] of Object.entries(expected)) {
  assert.equal(WINDOW_SURFACE_TITLES[kind as keyof typeof WINDOW_SURFACE_TITLES], want.title, `${kind} title`)
  assert.equal(surfaceKindLabel(kind as never), want.label, `${kind} label`)
  assert.equal(surfaceKindShortcut(kind as never), want.shortcut, `${kind} shortcut`)
  assert.equal(surfaceKindDescription(kind as never), want.summary, `${kind} summary`)
}
assert.deepEqual([...MULTI_INSTANCE_SURFACES].sort(), ['browser', 'files', 'terminal'])
assert.deepEqual([...SURFACE_POPOVER_KINDS].sort(), ['diff', 'files', 'pull-request'])
assert.equal(isMultiInstanceSurface('agents' as never), false)

// Built-in transcript views: one table feeds the menu, labels, descriptions, validation and base list.
import { TRANSCRIPT_VIEWS, TRANSCRIPT_VIEW_LABELS, TRANSCRIPT_VIEW_DESCRIPTIONS, TRANSCRIPT_VIEW_DISPLAY_NAMES, VIEW_SPEC_BASES, BUILTIN_VIEW_SPECS } from '../tui/viewSpec'
assert.deepEqual([...TRANSCRIPT_VIEWS], ['conversation', 'full', 'continue', 'stream', 'agents', 'chat', 'transcript', 'scrollback', 'codex', 'claude-code', 'copilot', 'opencode', 'engineering'])
assert.deepEqual(Object.values(TRANSCRIPT_VIEW_LABELS), ['CONVERSATION', 'FULL', 'CONTINUE', 'STREAM', 'AGENTS', 'CHAT', 'TRANSCRIPT', 'SCROLLBACK', 'CODEX', 'CLAUDE', 'COPILOT', 'OPENCODE', 'ENGINEERING'])
assert.equal(TRANSCRIPT_VIEW_DISPLAY_NAMES['claude-code'], 'Claude')
assert.equal(TRANSCRIPT_VIEW_DISPLAY_NAMES.opencode, 'OpenCode')
assert.equal(TRANSCRIPT_VIEW_DESCRIPTIONS.chat, 'Composer flows inline with the conversation, no dock')
assert.deepEqual([...VIEW_SPEC_BASES].sort(), TRANSCRIPT_VIEWS.filter(view => view !== 'engineering').sort(), 'every view but ENGINEERING can be a base')
assert.deepEqual(Object.keys(BUILTIN_VIEW_SPECS).sort(), [...TRANSCRIPT_VIEWS].sort())
console.log('surface metadata smoke passed')
