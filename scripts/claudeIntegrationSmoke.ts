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
import { createClaudeViewerQueryExtensions } from '../lib/claudeViewerIntegration'

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
  for (const event of ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'ConfigChange']) {
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
