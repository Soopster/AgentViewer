// Teammate name pool. A long-lived interactive chat delegates over and over,
// so a name held by a retired teammate is a slot lost for the life of the
// conversation — the ninth delegation failed with "pool exhausted" while
// nothing was running. Herdr clears a name when its agent exits.
import assert from 'node:assert/strict'
import type { ProtocolAgent } from '../lib/agentProtocol'
import { __availableTeammateNameForSmoke as availableTeammateName } from '../lib/agentCoordination'

const agent = (name: string, status: ProtocolAgent['status'], id = name): ProtocolAgent => ({
  id, runId: 'run', name, role: 'teammate', provider: 'claude', sessionId: `${id}-session`,
  worktreePath: '/tmp', worktreeBranch: '', status, createdAt: '', updatedAt: '',
} as ProtocolAgent)

assert.equal(availableTeammateName([]), 'nova', 'an empty roster takes the first name')
assert.equal(availableTeammateName([agent('nova', 'idle')]), 'orion')
assert.equal(availableTeammateName([agent('nova', 'working')]), 'orion', 'a working teammate holds its name')
assert.equal(availableTeammateName([agent('nova', 'blocked')]), 'orion', 'a blocked teammate is still there')
assert.equal(availableTeammateName([agent('nova', 'stopped')]), 'nova', 'a stopped teammate does not hold a name')
assert.equal(availableTeammateName([agent('nova', 'failed')]), 'nova', 'a failed teammate does not hold a name')

// A done teammate is what a follow-up reuses, but only while its session lives.
assert.equal(availableTeammateName([agent('nova', 'done')], new Set(['nova'])), 'orion', 'a done teammate with a live session is reusable, so it keeps its name')
assert.equal(availableTeammateName([agent('nova', 'done')]), 'nova', 'a done teammate whose session is gone releases its name')
assert.equal(availableTeammateName([agent('nova', 'done')], new Map([['nova', 'session-1']])), 'orion', 'the controller session map is accepted as-is')

// The pool is exhausted only by teammates that are actually there.
const full = ['nova', 'orion', 'lyra', 'vega', 'atlas', 'rhea', 'iris', 'flint'].map(name => agent(name, 'working'))
assert.equal(availableTeammateName(full), undefined, 'eight live teammates hold every name')
assert.equal(availableTeammateName(full.map((entry, index) => index === 3 ? agent(entry.name, 'stopped') : entry)), 'vega',
  'retiring one frees exactly its own name')

console.log('Teammate names: live holders keep names, retired ones release them, done keeps its name only while its session lives')
