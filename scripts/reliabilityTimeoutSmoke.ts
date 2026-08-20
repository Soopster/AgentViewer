// Verifies the composer-reliability mitigations added for slow/hung custom
// model providers (Claude cold-start loop, Codex turn/start, Codex
// model/list) without needing real Claude/Codex credentials or a custom
// model deployment. Two properties are load-bearing and checked here:
//   1) withTimeout actually bounds a promise that never settles.
//   2) The resulting error message is classified as auto-retryable by
//      isTransientSendError, so a hang on a real machine surfaces as a
//      silent client-side retry (per lib/transientError.ts) instead of a
//      permanently wedged composer.
// Run: npx tsx scripts/reliabilityTimeoutSmoke.ts
import { withTimeout } from '../lib/sessionBackend'
import { isTransientSendError } from '../lib/transientError'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`)
  console.log(`ok - ${message}`)
}

async function main() {
  // withTimeout's internal timer is intentionally unref'd (production code
  // races it against real network I/O that keeps the event loop alive on
  // its own). This script has nothing else pending, so without a ref'd
  // keep-alive Node exits silently the instant the loop is otherwise idle,
  // before the unref'd timer ever fires.
  const keepAlive = setInterval(() => {}, 1000)
  const never = new Promise<never>(() => {})

  const start = Date.now()
  let caught: Error | null = null
  try {
    await withTimeout(never, 100, 'smoke hung RPC')
  } catch (err) {
    caught = err as Error
  }
  const elapsed = Date.now() - start

  assert(caught !== null, 'a hung promise rejects instead of hanging forever')
  assert(elapsed < 1000, `timeout fires close to its bound (took ${elapsed}ms for a 100ms bound)`)
  assert(caught!.message.includes('smoke hung RPC') && caught!.message.includes('timed out'), 'timeout error names the call site and says "timed out"')
  assert(isTransientSendError(caught!.message), 'the timeout message is classified as auto-retryable by isTransientSendError')

  // A resolved promise inside the bound must pass its value through untouched.
  const resolved = await withTimeout(Promise.resolve('ok'), 5000, 'smoke fast RPC')
  assert(resolved === 'ok', 'a promise that resolves before the bound is unaffected')

  console.log('\nAll reliability-timeout checks passed.')
  clearInterval(keepAlive)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
