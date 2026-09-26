// Live smoke for which Codex threads this app holds loaded (lib/codexThreads.ts).
//
// Resuming a Codex thread loads it: the app-server starts every configured MCP
// server for it (~160MB of child processes per thread, measured on
// codex-cli 0.157) and keeps them until the thread is unsubscribed. Reads used
// to resume and never let go, so every session browsed — prefetches included —
// stayed loaded for the app-server's lifetime, and in the TUI the worker's
// app-server took the thread's writer away from the main isolate's.
//
// Whether we still hold a subscription is invisible from the transcript, so
// this asks the app-server directly: `thread/unsubscribe` answers
// `unsubscribed` only for a thread this connection was subscribed to.
//
//   bun run ./scripts/codexResumePolicySmoke.ts   (needs `codex` and >= 6 threads)
import { getCodexClient } from '../lib/codexClient'
import {
  ensureCodexThreadResumed,
  knownCodexThreadModel,
  prewarmCodexThread,
  readCodexThreadModel,
} from '../lib/codexThreads'
import { getSessionAdapter } from '../lib/adapters/registry'

const client = getCodexClient()
let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}
async function subscribed(threadId: string): Promise<boolean> {
  const { status } = await client.request('thread/unsubscribe', { threadId }) as { status?: string }
  return status === 'unsubscribed'
}

const list = await client.request('thread/list', { limit: 12 })
const ids = list.data.filter((thread) => !thread.ephemeral).map((thread) => thread.id)
if (ids.length < 6) {
  console.log(`SKIP need 6 Codex threads, found ${ids.length}`)
  process.exit(0)
}
const [info, read, prewarmA, prewarmB, claimed, prewarmC] = ids

// readSessionInfo runs for every read and prefetch: it must not resume at all.
const adapter = await getSessionAdapter('codex')
await adapter.readSessionInfo?.(info)
check('readSessionInfo leaves the thread unsubscribed', !(await subscribed(info)))

// A model read resumes once to learn the model, then lets go.
const { model } = await readCodexThreadModel(read)
check('readCodexThreadModel reports a model', typeof model === 'string' && model.length > 0, String(model))
check('readCodexThreadModel leaves the thread unsubscribed', !(await subscribed(read)))
check('the learned model is remembered without resuming', knownCodexThreadModel(read) === model)

// Prewarm holds only the latest idle thread.
await prewarmCodexThread(prewarmA)
await prewarmCodexThread(prewarmB)
await new Promise((resolve) => setTimeout(resolve, 200)) // the eviction's unsubscribe is fire-and-forget
check('an older idle prewarm is released', !(await subscribed(prewarmA)))

// A prewarmed thread that a turn then uses is never released by a later
// prewarm — that is the session the user is typing into.
await prewarmCodexThread(claimed)
await ensureCodexThreadResumed(claimed)
await prewarmCodexThread(prewarmC)
await new Promise((resolve) => setTimeout(resolve, 200))
check('a claimed thread survives later prewarms', await subscribed(claimed))
check('the newest prewarm is held', await subscribed(prewarmC))
check('the prewarm it replaced is released', !(await subscribed(prewarmB)))

console.log(failures === 0 ? 'codex resume policy: ok' : `codex resume policy: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
