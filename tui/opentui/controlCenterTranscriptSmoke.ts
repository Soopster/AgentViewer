// Control-center transcript routing smoke: opening an agent from the Agent
// Control Center must land on THAT agent's own session transcript — never the
// lead's, never the previously selected session, never a blank reader.
// Hermetic pure-state test of the exact functions App.tsx uses: it replays the
// open flow (resolveCoordinationTranscriptTarget -> pin un-indexed tab ->
// select key) and then resolves what the reader would show via
// resolveSelectedSessionIndex + resolveSelectedSession.
import assert from 'node:assert/strict'

import type { Session } from '../../lib/types'
import {
  EXTERNAL_SESSION_PREFIX,
  resolveCoordinationTranscriptTarget,
  resolveSelectedSession,
  resolveSelectedSessionIndex,
  transcriptSessionKey,
} from './splitPaneState'

const NOW = 1_753_000_000_000

// Three coordinator agents with distinct sessions across providers, plus an
// external MCP participant and an agent whose session is not indexed yet.
const leadAgent = { name: 'lead', role: 'lead', provider: 'claude' as const, sessionId: 'sess-lead', worktreePath: '/repo' }
const novaAgent = { name: 'nova', role: 'teammate', provider: 'codex' as const, sessionId: 'sess-nova', worktreePath: '/repo/wt-nova' }
const ghostAgent = { name: 'ghost', role: 'teammate', provider: 'pi' as const, sessionId: 'sess-ghost', worktreePath: '' }
const mcpAgent = { name: 'cc-mcp', role: 'teammate', provider: 'claude' as const, sessionId: `${EXTERNAL_SESSION_PREFIX}abc-123`, worktreePath: '/repo' }

// Sidebar index: lead + nova are indexed (with a decoy first so sessions[0]
// is never a correct answer); ghost's session has not materialised yet.
const decoySession: Session = { sessionId: 'sess-decoy', provider: 'claude', lastModified: NOW - 5_000 }
const leadSession: Session = { sessionId: 'sess-lead', provider: 'claude', lastModified: NOW - 1_000 }
const novaSession: Session = { sessionId: 'sess-nova', provider: 'codex', lastModified: NOW - 2_000 }
const sessions: Session[] = [decoySession, leadSession, novaSession]
const sessionsByKey = new Map(sessions.map((session) => [transcriptSessionKey(session), session]))

// Minimal replay of App.tsx state: openTabSessions + selectedSessionKey.
let openTabSessions: Session[] = []
let selectedSessionKey: string | null = transcriptSessionKey(decoySession)
const notices: string[] = []

// Mirrors openCoordinationAgentSession in App.tsx (minus provider switching,
// which selectTabSession delegates to chooseProvider — both end in the same
// setSelectedSessionKey call this replays).
type SmokeAgent = { name: string; role: string; provider: Session['provider']; sessionId: string; worktreePath: string }

function openAgent(agent: SmokeAgent): void {
  const target = resolveCoordinationTranscriptTarget(agent, sessionsByKey, NOW)
  if (target.kind === 'unreadable') {
    notices.push(target.reason)
    return
  }
  if (!target.indexed && !openTabSessions.some((tab) => transcriptSessionKey(tab) === target.sessionKey)) {
    openTabSessions = [...openTabSessions, target.session]
  }
  selectedSessionKey = target.sessionKey
}

function readerSession(): Session | null {
  const selectedIndex = resolveSelectedSessionIndex(selectedSessionKey, sessions, transcriptSessionKey)
  return resolveSelectedSession(
    selectedSessionKey,
    selectedIndex,
    sessions,
    openTabSessions,
    transcriptSessionKey,
    (session) => Boolean(session.isPending),
  )
}

function assertReaderShows(agent: { name: string; provider: Session['provider']; sessionId: string }): void {
  const shown = readerSession()
  assert.ok(shown, `reader is blank after opening ${agent.name}`)
  const shownKey = transcriptSessionKey(shown)
  const expectedKey = transcriptSessionKey({ sessionId: agent.sessionId, provider: agent.provider })
  assert.equal(shownKey, expectedKey, `reader shows ${shownKey} after opening ${agent.name}, expected ${expectedKey}`)
  for (const other of [leadAgent, novaAgent, ghostAgent]) {
    if (other.sessionId === agent.sessionId) continue
    assert.notEqual(shownKey, transcriptSessionKey(other), `reader leaked ${other.name}'s session after opening ${agent.name}`)
  }
  assert.notEqual(shown, decoySession, `reader fell back to sessions[0] after opening ${agent.name}`)
}

// Indexed agent resolves to the indexed sidebar session object itself — the
// list-level metadata (lastModified) is what keeps the reader mtime guards on.
const leadTarget = resolveCoordinationTranscriptTarget(leadAgent, sessionsByKey, NOW)
assert.equal(leadTarget.kind, 'open')
assert.ok(leadTarget.kind === 'open' && leadTarget.indexed && leadTarget.session === leadSession)

openAgent(leadAgent)
assertReaderShows(leadAgent)

// Cross-provider agent: opening nova (codex) after lead (claude) lands on
// nova's session, not the previous selection.
openAgent(novaAgent)
assertReaderShows(novaAgent)

// Regression: switching selection twice in a row must track the latest agent.
openAgent(leadAgent)
openAgent(novaAgent)
assertReaderShows(novaAgent)
openAgent(leadAgent)
assertReaderShows(leadAgent)

// Un-indexed session: ghost is not in the sidebar list. Before the fix the
// selection fell back to sessions[0] (the decoy); the pinned open tab must win.
openAgent(ghostAgent)
const ghostShown = readerSession()
assert.ok(ghostShown)
assert.equal(transcriptSessionKey(ghostShown), 'pi:sess-ghost')
assert.equal(ghostShown.summary, 'ghost · teammate')
assertReaderShows(ghostAgent)

// External MCP participant: refused with an honest reason, selection untouched.
const before = readerSession()
openAgent(mcpAgent)
assert.equal(notices.length, 1)
assert.match(notices[0]!, /cc-mcp has no readable transcript: external MCP participant/)
assert.equal(readerSession(), before, 'external MCP open must not change the reader session')

// No session recorded at all: refused, not silently routed.
openAgent({ ...ghostAgent, name: 'empty', sessionId: '  ' })
assert.match(notices[1]!, /empty has no readable transcript: no session recorded/)

console.log('Control-center transcript routing smoke passed')
