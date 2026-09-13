import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  InMemorySessionStore,
  query,
  type HookInput,
  type SDKMessage,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import { openPrompt } from '../lib/sdkControlQuery'

const spawnLocal = (options: SpawnOptions) => spawn(options.command, options.args, {
  cwd: options.cwd,
  env: options.env as NodeJS.ProcessEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
  signal: options.signal,
})

// Always exercise the installed SDK/CLI control channel. This does not make a
// model request and therefore works on CI and developer machines without an
// authenticated Anthropic account.
const control = query({
  prompt: openPrompt(),
  options: {
    cwd: process.cwd(),
    maxTurns: 0,
    persistSession: false,
    spawnClaudeCodeProcess: spawnLocal,
  },
})
try {
  await control.initializationResult()
  const [file, skills, mcp] = await Promise.all([
    control.readFile('package.json', { maxBytes: 16 * 1024, encoding: 'utf-8' }),
    control.reloadSkills(),
    control.setMcpServers({}),
  ])
  assert.ok(file?.contents.includes('agent-viewer'))
  assert.ok(Array.isArray(skills.skills))
  assert.deepEqual(mcp.errors, {})
} finally {
  control.close()
}
console.log('claude live control parity: ok')

if (process.env.AGENT_VIEWER_CLAUDE_LIVE !== '1') {
  console.log('claude authenticated model parity: skipped (set AGENT_VIEWER_CLAUDE_LIVE=1)')
  process.exit(0)
}

const store = new InMemorySessionStore()
const observedHooks: string[] = []
const hook = async (input: HookInput) => {
  observedHooks.push(input.hook_event_name)
  return { continue: true as const }
}
const abortController = new AbortController()
const q = query({
  prompt: 'Reply with exactly LIVE_PARITY_OK. Do not use tools.',
  options: {
    cwd: process.cwd(),
    maxTurns: 1,
    maxBudgetUsd: 0.10,
    abortController,
    persistSession: true,
    enableFileCheckpointing: false,
    sessionStore: store,
    includeHookEvents: true,
    agent: 'live-parity',
    agents: {
      'live-parity': {
        description: 'Agent Viewer live parity verifier',
        prompt: 'Follow the test prompt exactly and do not use tools.',
        tools: [],
        disallowedTools: ['Bash', 'Edit', 'Write'],
        skills: [],
        model: 'inherit',
        initialPrompt: 'Run the requested live parity verification.',
        maxTurns: 1,
        background: false,
        memory: 'local',
        permissionMode: 'dontAsk',
        criticalSystemReminder_EXPERIMENTAL: 'Never modify files during this smoke test.',
      },
    },
    hooks: {
      SessionStart: [{ hooks: [hook] }],
      UserPromptSubmit: [{ hooks: [hook] }],
      Stop: [{ hooks: [hook] }],
      SessionEnd: [{ hooks: [hook] }],
    },
    spawnClaudeCodeProcess: spawnLocal,
  },
})

let resultText = ''
let sessionId = ''
let result: SDKMessage | undefined
try {
  await q.initializationResult()
  const [file, skills, mcp] = await Promise.all([
    q.readFile('package.json', { maxBytes: 16 * 1024, encoding: 'utf-8' }),
    q.reloadSkills(),
    q.setMcpServers({}),
  ])
  assert.ok(file?.contents.includes('agent-viewer'))
  assert.ok(Array.isArray(skills.skills))
  assert.deepEqual(mcp.errors, {})
  for await (const message of q) {
    result = message
    if ('session_id' in message && typeof message.session_id === 'string') sessionId = message.session_id
    if (message.type === 'result') {
      if (message.subtype !== 'success') throw new Error(`${message.subtype}: ${message.errors.join('; ')}`)
      resultText = message.result
    }
  }
} finally {
  q.close()
}

assert.ok(sessionId)
assert.match(resultText, /LIVE_PARITY_OK/)
assert.equal(result?.type, 'result')
assert.ok(observedHooks.includes('SessionStart'))
assert.ok(observedHooks.includes('UserPromptSubmit'))
assert.ok(store.size > 0)

console.log(`claude live parity smoke: ok (${sessionId})`)
