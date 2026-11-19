import assert from 'node:assert/strict'
import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { ClaudeNativeSpare } from '../lib/claudeNativeSpare'

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function handle() {
  const exit = deferred<void>()
  return { exited: exit.promise, closed: 0, close() { this.closed++; exit.resolve() } }
}

// Capacity, deduplication, late initialization, idle expiry and process death.
const slot = new ClaudeNativeSpare<ReturnType<typeof handle>>(20)
const first = deferred<ReturnType<typeof handle>>()
let starts = 0
let initializationSignal: AbortSignal | undefined
const preparing = slot.prepare('one', controller => {
  starts++; initializationSignal = controller.signal; return first.promise
})
const duplicate = slot.prepare('one', () => { throw new Error('duplicate initialization') })
await tick()
assert.equal(starts, 1)
assert.equal(slot.take('one'), null, 'send never waits for an initializer')
assert.equal(initializationSignal?.aborted, true)
const late = handle()
first.resolve(late)
await Promise.all([preparing, duplicate])
assert.equal(late.closed, 1)
const ready = handle()
await slot.prepare('two', async () => ready)
assert.equal(slot.take('wrong-instance'), null)
assert.equal(ready.closed, 1)
const owned = handle()
await slot.prepare('three', async () => owned)
assert.equal(slot.take('three'), owned)
assert.equal(slot.take('three'), null, 'a spare can only be taken once')
owned.close()
const expired = handle()
await slot.prepare('expiry', async () => expired)
await new Promise(resolve => setTimeout(resolve, 35))
assert.equal(expired.closed, 1)
const dead = handle()
await slot.prepare('death', async () => dead)
dead.close()
await tick()
assert.equal(slot.diagnostics().state, 'empty')
await slot.prepare('failure', async () => { throw new Error('CLI too old') })
assert.equal(slot.diagnostics().state, 'empty')

const serial = new ClaudeNativeSpare<ReturnType<typeof handle>>(1000)
const slow = deferred<ReturnType<typeof handle>>()
let newerStarts = 0
const slowPreparation = serial.prepare('slow', () => slow.promise)
await tick()
const superseded = serial.prepare('superseded', async () => { throw new Error('superseded start ran') })
const newest = serial.prepare('newest', async () => { newerStarts++; return handle() })
await tick()
assert.equal(newerStarts, 0, 'do not initialize a second process until the first settles')
const slowHandle = handle()
slow.resolve(slowHandle)
await Promise.all([slowPreparation, superseded, newest])
assert.equal(slowHandle.closed, 1)
assert.equal(newerStarts, 1)
assert.equal(serial.diagnostics().failures, 0)
serial.discard()

// Exercise the actual pool with SDK transport doubles; real tool factories and
// permission bridges still run. No provider requests or model tokens.
const sdk = await import('@anthropic-ai/claude-agent-sdk')
let preparedOptions: Sdk.Options | undefined
let claimedId: string | undefined
let refusal: string | undefined
let queriedCold = 0
let sent = 0
let closed = 0
let pendingClaim: ReturnType<typeof deferred<{ sessionId: string; cwd: string; sdkMcpSettled: boolean }>> | undefined
function fakeQuery() {
  const exit = deferred<void>()
  const iterator = (async function* () { await exit.promise })()
  return Object.assign(iterator, {
    initializationResult: async () => ({}),
    setPermissionMode: async () => {},
    setModel: async () => {},
    applyFlagSettings: async () => {},
    close: () => { exit.resolve(); closed++ },
  }) as unknown as Sdk.Query
}
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  ...sdk,
  query: () => { queriedCold++; return fakeQuery() },
  prewarm: async ({ options }: { options: Sdk.Options }) => {
    preparedOptions = options
    process.env.CLAUDE_AGENT_SDK_VERSION = "smoke-sdk-version"
    const claim = deferred<{ sessionId: string; cwd: string; sdkMcpSettled: boolean }>()
    void claim.promise.catch(() => {})
    const exit = deferred<void>()
    let q: Sdk.Query | undefined
    return {
      exited: exit.promise,
      claimed: claim.promise,
      close() { exit.resolve(); q?.close(); claim.reject(new Error('spare_closed')); closed++ },
      claim({ prompt, options: claimOptions }: { prompt: AsyncIterable<Sdk.SDKUserMessage>; options: Sdk.ClaimOptions }) {
        claimedId = options.sessionId
        q = fakeQuery()
        // Read exactly what a real CLI would see. Nothing may be enqueued by
        // the host until it has checked the claim's identity and outcome.
        void (async () => { for await (const _ of prompt) sent++ })()
        if (refusal) claim.reject(new Error(refusal))
        else if (pendingClaim) {
          void pendingClaim.promise.then(claim.resolve, claim.reject)
        } else claim.resolve({ sessionId: options.sessionId!, cwd: claimOptions.cwd, sdkMcpSettled: true })
        return q
      },
    }
  },
}))
const pool = await import('../lib/claudePool')
const opts = { sessionId: '11111111-1111-4111-8111-111111111111', cwd: process.cwd(), isPendingSession: true }
delete process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM
assert.equal(await pool.prepareNativeClaudeSession(opts), false)
process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM = '1'
assert.equal(await pool.prepareNativeClaudeSession({ ...opts, isPendingSession: false }), false)
assert.equal(await pool.prepareNativeClaudeSession(opts), true)
assert.equal(preparedOptions?.sessionId, opts.sessionId)
assert.equal(preparedOptions?.cwd, undefined, 'park outside the project')
assert.ok(preparedOptions?.mcpServers?.['agent-viewer-messaging'], 'retain session-bound MCP tools')
pendingClaim = deferred()
const claim = pool.claimNativeClaudeSession(opts, new AbortController().signal)
const duplicateClaim = pool.claimNativeClaudeSession(opts, new AbortController().signal)
await tick()
assert.equal(sent, 0, 'the input stream is empty while claiming')
assert.equal(pool.peekClaudeSession(opts.sessionId), null)
pendingClaim.resolve({ sessionId: opts.sessionId, cwd: opts.cwd, sdkMcpSettled: true })
await Promise.all([claim, duplicateClaim])
pendingClaim = undefined
assert.equal(claimedId, opts.sessionId)
const entry = pool.acquireClaudeSession({ ...opts, enableWorkflow: false, permissionMode: 'default' })
await entry.whenConfigured()
await entry.whenInitialized()
assert.equal(entry.reused, true)
assert.equal(queriedCold, 0)
entry.pushUserMessage({ type: 'user', session_id: opts.sessionId, parent_tool_use_id: null, message: { role: 'user', content: 'once' } })
await tick()
assert.equal(sent, 1)
pool.recycleClaudeSession(opts.sessionId)

for (const reason of ['permission_mode_not_claimable', 'option_not_applied']) {
  refusal = reason
  await pool.prepareNativeClaudeSession(opts)
  await pool.claimNativeClaudeSession(opts, new AbortController().signal)
  assert.equal(pool.peekClaudeSession(opts.sessionId), null)
  assert.equal(sent, 1, 'a refused claim has never received the prompt')
  pool.acquireClaudeSession(opts)
  pool.recycleClaudeSession(opts.sessionId)
}
assert.equal(queriedCold, 2, 'normal startup remains available after either refusal')
refusal = undefined

await pool.prepareNativeClaudeSession(opts)
await pool.claimNativeClaudeSession({ ...opts, permissionMode: 'bypassPermissions' }, new AbortController().signal)
assert.equal(pool.peekClaudeSession(opts.sessionId), null, 'changed permissions discard the spare')
await pool.prepareNativeClaudeSession(opts)
const aborted = new AbortController()
aborted.abort()
await pool.claimNativeClaudeSession(opts, aborted.signal)
assert.equal(pool.peekClaudeSession(opts.sessionId), null)
await pool.prepareNativeClaudeSession(opts)
pendingClaim = deferred()
const wrongIdentity = pool.claimNativeClaudeSession(opts, new AbortController().signal)
pendingClaim.resolve({ sessionId: 'other', cwd: opts.cwd, sdkMcpSettled: true })
await wrongIdentity
assert.equal(pool.peekClaudeSession(opts.sessionId), null)
assert.equal(sent, 1)
pendingClaim = undefined
const dynamic = await import('../lib/claudeDynamicMcp')
await pool.prepareNativeClaudeSession(opts)
dynamic.setClaudeDynamicMcpServers(opts.sessionId, { changed: { command: 'smoke-only' } })
await pool.claimNativeClaudeSession(opts, new AbortController().signal)
assert.equal(pool.peekClaudeSession(opts.sessionId), null, 'MCP binding changes discard the spare')
dynamic.clearClaudeDynamicMcpServers(opts.sessionId)
await pool.prepareNativeClaudeSession(opts)
const oldEndpoint = process.env.ANTHROPIC_BASE_URL
process.env.ANTHROPIC_BASE_URL = 'https://smoke.invalid'
await pool.claimNativeClaudeSession(opts, new AbortController().signal)
assert.equal(pool.peekClaudeSession(opts.sessionId), null, 'provider environment changes discard the spare')
if (oldEndpoint === undefined) delete process.env.ANTHROPIC_BASE_URL
else process.env.ANTHROPIC_BASE_URL = oldEndpoint
await pool.prepareNativeClaudeSession(opts)
pendingClaim = deferred()
const interrupted = new AbortController()
const interruptedClaim = pool.claimNativeClaudeSession(opts, interrupted.signal)
interrupted.abort()
await interruptedClaim
assert.equal(pool.peekClaudeSession(opts.sessionId), null, 'cancellation during a claim releases the Query')
pendingClaim.resolve({ sessionId: opts.sessionId, cwd: opts.cwd, sdkMcpSettled: true })
pendingClaim = undefined
await pool.prepareNativeClaudeSession(opts)
pendingClaim = deferred()
const changedDuringClaim = pool.claimNativeClaudeSession(opts, new AbortController().signal)
dynamic.setClaudeDynamicMcpServers(opts.sessionId, { changed: { command: 'smoke-only' } })
pendingClaim.resolve({ sessionId: opts.sessionId, cwd: opts.cwd, sdkMcpSettled: true })
await changedDuringClaim
assert.equal(pool.peekClaudeSession(opts.sessionId), null, 'bindings must still match after the async claim')
assert.equal(sent, 1)
dynamic.clearClaudeDynamicMcpServers(opts.sessionId)
assert.ok(closed > 0)
delete process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM
console.log('Native Claude spare smoke passed: lifecycle, single claim, pending identity, empty-input fallback, permissions, cancellation and pool reuse')
