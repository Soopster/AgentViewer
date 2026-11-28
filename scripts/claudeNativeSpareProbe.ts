// Real SDK/CLI startup measurements, with isolated settings and no model prompt.
// This measures initialization/claim latency, not first-token latency.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalCwd = process.cwd()
const originalConfig = process.env.CLAUDE_CONFIG_DIR
const originalOptIn = process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM
const root = await mkdtemp(join(tmpdir(), 'agentviewer-native-spare-'))
process.chdir(root)
process.env.CLAUDE_CONFIG_DIR = root
process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM = '1'
const pool = await import('../lib/claudePool')
let sessionId = ''
const samples: Array<{ coldInitializationMs: number; existingPoolAcquireMs: number; nativeInitializationMs: number; nativeClaimMs: number }> = []
try {
  for (let iteration = 0; iteration < 3; iteration++) {
    sessionId = randomUUID()
    let opts = { sessionId, cwd: root, isPendingSession: true }
    const coldStarted = performance.now()
    const cold = pool.acquireClaudeSession(opts)
    await cold.whenInitialized()
    const coldInitializationMs = performance.now() - coldStarted
    const warmStarted = performance.now()
    const warm = pool.acquireClaudeSession(opts)
    assert.equal(warm.reused, true)
    await Promise.all([warm.whenInitialized(), warm.whenConfigured()])
    const existingPoolAcquireMs = performance.now() - warmStarted
    pool.recycleClaudeSession(sessionId)

    sessionId = randomUUID()
    opts = { ...opts, sessionId }
    assert.equal(await pool.prepareNativeClaudeSession(opts), true)
    assert.equal(pool.claudeNativePrewarmDiagnostics().state, 'ready')
    await pool.claimNativeClaudeSession(opts, new AbortController().signal)
    const native = pool.peekClaudeSession(sessionId)
    assert.ok(native, 'native spare must be adopted into the pool')
    await native.whenInitialized()
    assert.equal(native.sessionId, sessionId)
    const stats = pool.claudeNativePrewarmDiagnostics()
    samples.push({ coldInitializationMs, existingPoolAcquireMs, nativeInitializationMs: stats.initializationMs, nativeClaimMs: stats.claimMs })
    pool.recycleClaudeSession(sessionId)
  }
  console.log(JSON.stringify({ scope: 'isolated SDK/CLI startup; no model prompts or first-token measurements', samples }, null, 2))
} finally {
  if (sessionId) pool.recycleClaudeSession(sessionId)
  process.chdir(originalCwd)
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfig
  if (originalOptIn === undefined) delete process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM
  else process.env.AGENT_VIEWER_CLAUDE_NATIVE_PREWARM = originalOptIn
  // SDK close requests exit asynchronously. Wait for its cleanup before removal.
  await new Promise(resolve => setTimeout(resolve, 200))
  await rm(root, { recursive: true, force: true })
}
