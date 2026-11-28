import assert from 'node:assert/strict'
import { createOpencodeClient } from '@opencode-ai/sdk'
import { createOpencodeClient as createQuestionClient } from '@opencode-ai/sdk/v2'
import { toV1Session, type V2SessionInfo } from '../lib/opencode2Mapping'
import { opencodeAdapter } from '../lib/adapters/opencode'
import '../lib/opencodeHarness'

const source: V2SessionInfo = { id: 'session', projectID: 'project', agent: 'plan', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 }, location: { directory: '/project' } }
let session = toV1Session(source)
let messageReads = 0
let historicalAgent: string | undefined = 'build'
const client = createOpencodeClient({ baseUrl: 'http://agent.invalid', fetch: async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.pathname === '/session/session') return Response.json(session)
  if (url.pathname.endsWith('/message')) {
    messageReads += 1
    return Response.json(historicalAgent ? [{ info: { id: 'user', role: 'user', agent: historicalAgent, time: { created: 1 } }, parts: [] }] : [])
  }
  throw new Error(`Unexpected request: ${url}`)
} })
globalThis.__agentViewerOpenCodeRuntimePromise = Promise.resolve({ client,
  clientV2: createQuestionClient({ baseUrl: 'http://unused.invalid' }), server: null, generation: 1,
})
globalThis.__openCodeHarness = {
  ensureStarted() {},
  async getProjectDiagnostics() { return { agents: [
    { name: 'build', mode: 'primary', builtIn: true }, { name: 'plan', mode: 'primary', builtIn: true },
    { name: 'review', mode: 'primary', builtIn: false },
  ] } },
} as unknown as NonNullable<typeof globalThis.__openCodeHarness>
assert.equal((await opencodeAdapter.readComposerOptions!('session')).currentAgent, 'plan')
assert.equal(messageReads, 0, 'authoritative agent lookup must not read a long transcript')
session = toV1Session({ ...source, agent: 'review' })
assert.equal((await opencodeAdapter.readComposerOptions!('session')).currentAgent, 'review', 'external switches must be reflected before another user prompt')
session = toV1Session({ ...source, agent: 'plan' })
historicalAgent = undefined
assert.equal((await opencodeAdapter.readComposerOptions!('session')).currentAgent, 'plan', 'a session without user messages still has a selected agent')
const { openCode2Agent: _agent, ...legacy } = session as typeof session & { openCode2Agent?: string }
session = { ...legacy, version: '1' }
historicalAgent = 'review'
assert.equal((await opencodeAdapter.readComposerOptions!('session')).currentAgent, 'review', 'v1 still uses history when the session has no authoritative agent')
historicalAgent = undefined
assert.equal((await opencodeAdapter.readComposerOptions!('session')).currentAgent, 'build', 'empty v1 sessions keep the built-in fallback')
console.log('OpenCode agent selection smoke passed: current session agent, external switches, empty sessions, no v2 transcript lookup, v1 fallbacks')
