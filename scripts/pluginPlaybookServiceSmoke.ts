import assert from 'node:assert/strict'
import { createWebPlaybooksService } from '../components/shell/playbooksService'
import type { RunPlaybook } from '../lib/agentProtocol'

type Call = { url: URL; init: RequestInit }
const calls: Call[] = []
let respond: () => Promise<Response> = async () => Response.json({})
const service = createWebPlaybooksService((async (input, init) => {
  calls.push({ url: new URL(String(input), 'http://localhost'), init: init ?? {} })
  return respond()
}) as typeof fetch)
const controller = new AbortController()
const signal = controller.signal
const cwd = '/workspace/project with spaces & unicode-λ'
const name = 'release & review/λ'
const playbook: RunPlaybook = {
  name: 'release-review', description: 'Preserve the whole definition', argsHint: '{{args.branch}}',
  maxAgents: 3, gateCommand: 'npm run check', requirePlanApproval: true, requireReview: true,
  phases: [{ title: 'Review', tasks: [{ key: 'audit', title: 'Audit', detail: '{{args.branch}}',
    paths: ['src/**'], provider: 'codex', model: 'fixture-model', effort: 'high', verifyCommands: ['npm run check'] }] }],
}
function last(method: string, expectedName?: string, body?: unknown) {
  const call = calls.at(-1)!
  assert.equal(call.url.pathname, '/api/agent-protocol/playbooks')
  assert.equal(call.url.searchParams.get('cwd'), cwd, 'repository context survives query encoding')
  assert.equal(call.url.searchParams.get('name'), expectedName ?? null)
  assert.equal(call.init.method ?? 'GET', method)
  assert.equal(call.init.cache, 'no-store')
  assert.equal(call.init.signal, signal, 'the captured cancellation signal reaches HTTP')
  if (body !== undefined) {
    assert.deepEqual(JSON.parse(String(call.init.body)), body, 'write payload retains the complete definition and previous name')
    assert.equal(new Headers(call.init.headers).get('Content-Type'), 'application/json')
  }
}
const listing = {
  playbooks: [{ name: playbook.name, path: '/workspace/playbooks/release-review.json', phaseCount: 1, taskCount: 1, expectsArgs: true }],
  invalid: [{ file: '/workspace/playbooks/broken.json', error: 'Invalid phase' }],
}
respond = async () => Response.json(listing)
assert.deepEqual(await service.list(cwd, signal), listing, 'invalid definitions stay visible to the manager')
last('GET')
respond = async () => Response.json({ playbook })
assert.deepEqual(await service.read(cwd, name, signal), playbook)
last('GET', name)
const written = { playbook, path: '/workspace/playbooks/release-review.json' }
respond = async () => Response.json(written)
assert.deepEqual(await service.write(cwd, playbook, 'old-name', signal), written)
last('PUT', undefined, { cwd, playbook, previousName: 'old-name' })
respond = async () => Response.json({ deleted: true, name })
assert.equal(await service.remove(cwd, name, signal), undefined)
last('DELETE', undefined, { cwd, name })

// Start a request, then change the caller's selected repository before it settles.
let release!: (response: Response) => void
respond = () => new Promise(resolve => { release = resolve })
let selectedCwd = cwd
const pending = service.read(selectedCwd, name, signal)
selectedCwd = '/workspace/next-project'
release(Response.json({ playbook }))
assert.deepEqual(await pending, playbook)
last('GET', name)
assert.notEqual(calls.at(-1)!.url.searchParams.get('cwd'), selectedCwd)

for (const operation of [
  () => service.list(cwd, signal), () => service.read(cwd, name, signal),
  () => service.write(cwd, playbook, undefined, signal), () => service.remove(cwd, name, signal),
]) {
  respond = async () => Response.json({ error: 'Playbook already exists' }, { status: 409 })
  await assert.rejects(operation, /Playbook already exists/, 'HTTP errors must reach the feature')
  respond = async () => Response.json({}, { status: 503 })
  await assert.rejects(operation, /503/, 'HTTP failures without an error body cannot report success')
}
respond = async () => Response.json({ error: 'Rejected definition' })
await assert.rejects(() => service.write(cwd, playbook), /Rejected definition/)
const transportFailure = new Error('network unavailable')
respond = async () => { throw transportFailure }
await assert.rejects(() => service.list(cwd), error => error === transportFailure)

const aborted = new AbortController()
const cancellation = new DOMException('manager closed', 'AbortError')
aborted.abort(cancellation)
const before = calls.length
await assert.rejects(() => service.list(cwd, aborted.signal), error => error === cancellation)
assert.equal(calls.length, before, 'already cancelled operations never issue HTTP')

const closing = new AbortController()
respond = () => new Promise(resolve => { release = resolve })
const lateRead = service.read(cwd, name, closing.signal)
closing.abort(cancellation)
release(Response.json({ playbook }))
await assert.rejects(() => lateRead, error => error === cancellation, 'a transport ignoring cancellation cannot return late data')
assert.equal(calls.at(-1)!.init.signal, closing.signal)
console.log('Playbook service: PASS (HTTP CRUD, complete payloads, repository capture, invalid definitions, errors and cancellation)')
