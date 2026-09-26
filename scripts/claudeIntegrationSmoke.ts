import assert from 'node:assert/strict'
import {
  buildClaudeSshInvocation,
  type ClaudeSshSpawnerConfig,
} from '../lib/claudeProcessSpawner'
import {
  getClaudeDynamicMcpServers,
  parseClaudeDynamicMcpServers,
  setClaudeDynamicMcpServers,
} from '../lib/claudeDynamicMcp'
import { deleteClaudeHookEvents, listClaudeHookEvents } from '../lib/claudeHookEvents'
import { claudeResultHasQueuedTurns, sequenceClaudePoolConfiguration } from '../lib/claudePool'
import { createClaudeViewerQueryExtensions, reportClaudePluginLoadFailures } from '../lib/claudeViewerIntegration'
import { claudePluginLoadFailures } from '../lib/claudeSdkFeatures'
import { dismissViewerAttention, listViewerAttention } from '../lib/viewerAttention'

assert.deepEqual(claudePluginLoadFailures({ type: 'system', subtype: 'init' }), [])
assert.deepEqual(claudePluginLoadFailures({
  type: 'system', subtype: 'init', plugin_errors: [
    { plugin: 'broken@marketplace', type: 'dependency-unsatisfied', message: 'Dependency missing', path: '/plugins/broken' },
    { plugin: 42, type: 'generic-error', message: 'Malformed row' },
  ],
}), [{ plugin: 'broken@marketplace', type: 'dependency-unsatisfied', message: 'Dependency missing', path: '/plugins/broken' }])
assert.deepEqual(claudePluginLoadFailures({ type: 'system', subtype: 'informational', plugin_errors: [{ plugin: 'x', type: 'error', message: 'ignore' }] }), [])

const pluginFailureSession = `plugin-failure-smoke-${Date.now()}`
const pluginFailureFrame = {
  type: 'system', subtype: 'init', plugin_errors: [
    { plugin: 'broken@marketplace', type: 'dependency-unsatisfied', message: 'Dependency missing', path: '/plugins/broken' },
  ],
}
const reportedPluginFailures = new Set<string>()
assert.equal(reportClaudePluginLoadFailures(pluginFailureSession, pluginFailureFrame, reportedPluginFailures), 1)
assert.equal(reportClaudePluginLoadFailures(pluginFailureSession, pluginFailureFrame, reportedPluginFailures), 0)
const pluginAttention = listViewerAttention().filter((note) => note.sessionId === pluginFailureSession)
assert.equal(pluginAttention.length, 1)
assert.match(pluginAttention[0]!.detail ?? '', /Dependency missing/)
for (const note of pluginAttention) dismissViewerAttention(note.id)

assert.equal(claudeResultHasQueuedTurns({ type: 'result', queued_turn_count: 2 } as never), true)
assert.equal(claudeResultHasQueuedTurns({ type: 'result', queued_turn_count: 0 } as never), false)
assert.equal(claudeResultHasQueuedTurns({ type: 'assistant' } as never), false)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

const initialization = deferred()
const previousTurn = deferred()
let configurationApplied = false
const configuration = sequenceClaudePoolConfiguration({
  previousSettings: Promise.resolve(),
  previousTurn: previousTurn.promise,
  initialization: initialization.promise,
  isAlive: () => true,
  apply: async () => { configurationApplied = true },
})
await Promise.resolve()
assert.equal(configurationApplied, false, 'Claude model changes must wait for the active turn')
previousTurn.resolve()
await Promise.resolve()
assert.equal(configurationApplied, false, 'Claude model changes must wait for Query initialization')
initialization.resolve()
await configuration
assert.equal(configurationApplied, true, 'Claude model changes apply after turn and initialization readiness')

const servers = parseClaudeDynamicMcpServers({
  docs: {
    type: 'http',
    url: 'https://example.test/mcp',
    headers: { Accept: 'application/json' },
    tools: [{ name: 'search', permission_policy: 'always_ask', org_max_permission: 'ask' }],
  },
  local: { type: 'stdio', command: 'node', args: ['server.mjs'], env: { MODE: 'test' } },
})
assert.equal(servers.docs.type, 'http')
assert.deepEqual(servers.docs.type === 'http' ? servers.docs.tools : undefined, [
  { name: 'search', permission_policy: 'always_ask', org_max_permission: 'ask' },
])
assert.equal(servers.local.type, 'stdio')
assert.throws(() => parseClaudeDynamicMcpServers({ bad: { type: 'file', url: 'file:///tmp/mcp' } }))
assert.throws(() => parseClaudeDynamicMcpServers({ 'agent-viewer': { type: 'http', url: 'https://example.test/mcp' } }), /reserved/)
setClaudeDynamicMcpServers('smoke-session', servers)
assert.deepEqual(Object.keys(getClaudeDynamicMcpServers('smoke-session')).sort(), ['docs', 'local'])
setClaudeDynamicMcpServers('smoke-session', {})

const sshConfig: ClaudeSshSpawnerConfig = {
  host: 'worker.example.test',
  user: 'claude',
  port: 2222,
  identityFile: '/keys/worker',
  knownHostsFile: '/keys/known_hosts',
  remoteCommand: '/opt/claude/cli.js',
  localRoot: '/workspace',
  remoteRoot: '/srv/workspace',
}
const invocation = buildClaudeSshInvocation({
  command: 'node',
  args: ['--sdk-cli', 'stream-json'],
  cwd: '/workspace/project',
  env: { CLAUDE_ENABLE_STREAM_WATCHDOG: '1', ANTHROPIC_API_KEY: 'must-not-leak', PATH: '/bin' },
  signal: new AbortController().signal,
}, sshConfig)
assert.equal(invocation.target, 'claude@worker.example.test')
assert.ok(invocation.args.includes('BatchMode=yes'))
assert.ok(invocation.args.includes('StrictHostKeyChecking=yes'))
assert.match(invocation.command, /srv\/workspace\/project/)
assert.match(invocation.command, /CLAUDE_ENABLE_STREAM_WATCHDOG=1/)
assert.doesNotMatch(invocation.command, /must-not-leak/)

const sessionId = `smoke-${Date.now()}`
try {
  const extensions = createClaudeViewerQueryExtensions({
    getSessionId: () => sessionId,
    getCwd: () => process.cwd(),
  })
  const hooks = extensions.hooks as unknown as Record<string, Array<{ hooks: Array<(input: never, toolUseId?: string) => Promise<unknown>> }>>
  for (const event of ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'SubagentStart', 'SubagentStop', 'ConfigChange']) {
    assert.ok(hooks[event]?.[0]?.hooks[0], `${event} observability hook is missing`)
  }
  assert.equal(hooks.MessageDisplay, undefined)
  await hooks.ConfigChange![0]!.hooks[0]!({
    hook_event_name: 'ConfigChange',
    session_id: sessionId,
    source: 'settings',
    apiKey: 'redact-me',
  } as never)
  const found = await listClaudeHookEvents(sessionId, { query: 'configchange' })
  assert.equal(found.length, 1)
  assert.equal(found[0]?.payload.apiKey, '[redacted]')
} finally {
  await deleteClaudeHookEvents(sessionId)
}
assert.deepEqual(await listClaudeHookEvents(sessionId), [])

console.log('claude integration smoke: ok')
