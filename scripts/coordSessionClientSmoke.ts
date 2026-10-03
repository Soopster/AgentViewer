import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const exec = promisify(execFile)
const cwd = await mkdtemp(path.join(tmpdir(), 'coord-session-client-'))
process.chdir(cwd)
await exec('git', ['init', '-q'])
await writeFile('README.md', 'fixture\n')
await exec('git', ['add', '.'])
await exec('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../lib/agentCoordination')
const { getCoordinatorBridgeUrl } = await import('../lib/coordinatorBridgeServer')
const { writeCoordinatorSessionClient } = await import('../lib/coordinatorSessionClient')
const lead = (await coord.createExternalProtocolRun({ baseCwd: cwd, provider: 'codex', prompt: 'Session client smoke', participantName: 'lead', maxAgents: 2 })).participant
try {
  const directory = path.join(cwd, 'private binding with spaces')
  const command = await writeCoordinatorSessionClient(directory, await getCoordinatorBridgeUrl(), lead)
  assert.ok(!command.includes(lead.token), 'credentials must not enter the model prompt')
  const binding = path.join(directory, (await readdir(directory)).find(file => file.endsWith('.json'))!)
  const client = path.join(directory, 'client.mjs')
  assert.equal((await stat(binding)).mode & 0o777, 0o600)
  const call = async (tool: string, args: object) => JSON.parse((await exec(process.execPath, [client, binding, tool, JSON.stringify(args)])).stdout)
  const before = await call('coord_status', {})
  assert.equal(before.snapshot.tasks.length, 0)
  const args = { title: 'Read-only fixture check', detail: 'Inspect the fixture only', request_id: 'stable-first-request' }
  const first = await call('coord_create_task', args)
  const replay = await call('coord_create_task', args)
  assert.equal(first.task.id, replay.task.id)
  assert.equal((await call('coord_status', {})).snapshot.tasks.length, 1)
  await assert.rejects(() => call('coord_create_task', { title: 'Missing key', detail: 'Do not create' }), /request_id/)
  const secret = JSON.parse(await readFile(binding, 'utf8'))
  await writeFile(binding, JSON.stringify({ ...secret, token: 'invalid-participant-token' }))
  await assert.rejects(() => call('coord_status', {}))
  assert.equal((await coord.readExternalProtocolStatus(lead)).snapshot.tasks.length, 1)
  console.log('Existing-thread CLI fallback: authenticated reads, keyed mutation replay, missing-key rejection, private bindings and invalid-token rejection passed')
} finally { await coord.stopProtocolRun(lead.runId) }
