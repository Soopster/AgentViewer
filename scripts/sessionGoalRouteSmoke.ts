// Session goals over HTTP, against the real route handlers.
//
// Both UIs talk to this API, so the contract belongs in a smoke: a goal is
// per provider account, an empty objective is refused, and a pause survives a
// page reload. Nothing here reaches a model — only resuming a goal wakes the
// auditor, and that is left out on purpose.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// The store and provider state resolve .agent-viewer-data from process.cwd(),
// so pick the directory before the route is imported.
const cwd = mkdtempSync(path.join(tmpdir(), 'agent-viewer-goal-route-smoke-'))
mkdirSync(path.join(cwd, '.agent-viewer-data'), { recursive: true })
writeFileSync(path.join(cwd, '.agent-viewer-data', 'provider.json'), JSON.stringify({ provider: 'claude' }))
process.chdir(cwd)

const route = await import('../app/api/sessions/[sessionId]/goal/route')
const goalsFile = path.join(cwd, '.agent-viewer-data', 'session-goals.json')

type Call = (options?: { provider?: string; body?: unknown }) => Promise<{ status: number; json: any }>

function handler(name: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Call {
  const fn = (route as unknown as Record<string, CallableFunction>)[name]
  return async ({ provider = 'claude', body } = {}) => {
    const request = new Request(`http://localhost/api/sessions/ses_1/goal?provider=${provider}`, {
      method: name === 'GET' ? 'GET' : name,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const response = await fn(request, { params: Promise.resolve({ sessionId: 'ses_1' }) })
    return { status: response.status, json: await response.json() }
  }
}

const get = handler('GET')
const post = handler('POST')
const patch = handler('PATCH')
const remove = handler('DELETE')

{
  const empty = await get()
  assert(empty.status === 200 && empty.json.goal === null, 'a session with no goal reads as null, not an error')
  assert(!existsSync(goalsFile), 'reading does not create the goal file')
}

{
  const refused = await post({ body: { objective: '   ' } })
  assert(refused.status === 400 && refused.json.error === 'objective is required', 'an empty objective is refused')
}

{
  const created = await post({ body: { objective: ' Ship the login flow ', tokenBudget: 12_000.7, maxContinuations: 3 } })
  assert(created.status === 200, `creating a goal succeeds: ${JSON.stringify(created.json)}`)
  const goal = created.json.goal
  assert(goal.objective === 'Ship the login flow', 'the objective is trimmed')
  assert(goal.status === 'active', 'a new goal is active')
  assert(goal.tokenBudget === 12_000, 'the token budget is floored, so it can be compared with counted tokens')
  assert(goal.maxContinuations === 3, 'a continuation cap is honoured')
  assert(goal.continuations === 0 && goal.tokensUsed === 0, 'a new goal has spent and continued nothing')

  const stored = JSON.parse(readFileSync(goalsFile, 'utf8')) as Record<string, { objective: string }>
  assert(Object.keys(stored).length === 1, 'exactly one goal lands in the file')
  console.log('Creating a goal stores it once, trimmed, with its limits.')
}

{
  const read = await get()
  assert(read.json.goal?.objective === 'Ship the login flow', 'the goal reads back')
  const otherProvider = await get({ provider: 'codex' })
  assert(otherProvider.json.goal === null, 'another provider account does not share the goal')

  const lowered = await post({ body: { objective: 'Ship the login flow', tokenBudget: -5 } })
  assert(lowered.json.goal.tokenBudget === null, 'a non-positive budget means no ceiling')
  assert(lowered.json.goal.maxContinuations === 25, 'a missing continuation cap takes the default')
  console.log('A goal is scoped to the account that created it.')
}

{
  const paused = await patch({ body: { status: 'paused', lastNote: 'Waiting on review' } })
  assert(paused.status === 200 && paused.json.goal.status === 'paused', 'a goal pauses')
  assert(paused.json.goal.lastNote === 'Waiting on review', 'the note is kept with the pause')

  const edited = await patch({ body: { objective: 'Ship the whole flow', tokenBudget: null } })
  assert(edited.json.goal.objective === 'Ship the whole flow', 'the objective is editable')
  assert(edited.json.goal.status === 'paused', 'editing does not restart a paused goal')

  const unknownStatus = await patch({ body: { status: 'keeps going' } })
  assert(unknownStatus.status === 200 && unknownStatus.json.goal.status === 'paused', 'an unknown status is ignored, not written')

  console.log('Pausing and editing keep the goal where the user left it.')
}

{
  // A provider the session never had must not create an empty goal row.
  const otherProviderPatch = await patch({ provider: 'codex', body: { status: 'paused' } })
  assert(otherProviderPatch.status === 404, 'patching another account reports no goal instead of inventing one')

  const removed = await remove()
  assert(removed.json.ok === true, 'clearing reports success')
  const again = await remove()
  assert(again.json.ok === false, 'clearing twice is not silently successful')
  const gone = await get()
  assert(gone.json.goal === null, 'a cleared goal is gone')
  console.log('Clearing removes the goal and reports whether anything was there.')
}

console.log('session goal route smoke passed')
process.exit(0)
