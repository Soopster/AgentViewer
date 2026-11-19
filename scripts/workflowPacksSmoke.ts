import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WORKFLOW_PACKS, inspectWorkflowPack, installWorkflowPack, parseWorkflowPack } from '../lib/plugins/workflowPacks'
import { parseRunPlaybook, playbookExpectsArgs, type RunPlaybook } from '../lib/agentProtocol'
import type { PluginPlaybookService } from '../lib/plugins/playbooks'
import { listRunPlaybooks, loadRunPlaybook, writeRunPlaybook, deleteRunPlaybook } from '../lib/agentCoordination'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'workflow-packs-'))), cwd = path.join(temp, 'repo')
await mkdir(cwd)
const service: PluginPlaybookService = { list: listRunPlaybooks, read: loadRunPlaybook, write: writeRunPlaybook, remove: async (root, name) => { await deleteRunPlaybook(root, name) } }
try {
  for (const pack of WORKFLOW_PACKS) {
    assert.deepEqual(parseWorkflowPack(JSON.stringify(pack)), pack)
    for (const playbook of pack.playbooks) { assert(parseRunPlaybook(playbook)); assert(playbookExpectsArgs(playbook)) }
  }
  const pack = WORKFLOW_PACKS[0], name = pack.playbooks[0].name
  assert.equal((await inspectWorkflowPack(service, cwd, pack))[0].status, 'missing')
  assert.equal((await installWorkflowPack(service, cwd, pack)).installed.length, 1)
  assert.equal((await inspectWorkflowPack(service, cwd, pack))[0].status, 'installed')
  assert.equal((await installWorkflowPack(service, cwd, pack)).installed.length, 0, 'reinstall is idempotent')
  const local: RunPlaybook = { ...pack.playbooks[0], description: 'My local customization' }
  await writeRunPlaybook(cwd, local, name)
  assert.equal((await inspectWorkflowPack(service, cwd, pack))[0].status, 'customized')
  assert.equal((await installWorkflowPack(service, cwd, pack)).installed.length, 0)
  assert.equal((await loadRunPlaybook(cwd, name)).description, local.description)
  const next = WORKFLOW_PACKS[1].playbooks[0], races = await Promise.allSettled([writeRunPlaybook(cwd, next), writeRunPlaybook(cwd, { ...next, description: 'Concurrent custom writer' })])
  assert.equal(races.filter(result => result.status === 'fulfilled').length, 1, 'create-only playbook writes never clobber a concurrent file')
  assert(JSON.parse(await readFile(path.join(cwd, '.agent-viewer', 'playbooks', `${next.name}.json`), 'utf8')))
  const invalid = WORKFLOW_PACKS[2]
  await writeFile(path.join(cwd, '.agent-viewer', 'playbooks', `${invalid.playbooks[0].name}.json`), '{invalid')
  assert.equal((await inspectWorkflowPack(service, cwd, invalid))[0].status, 'invalid')
  await installWorkflowPack(service, cwd, invalid)
  assert.equal(await readFile(path.join(cwd, '.agent-viewer', 'playbooks', `${invalid.playbooks[0].name}.json`), 'utf8'), '{invalid')
  await assert.rejects(async () => parseWorkflowPack(JSON.stringify({ ...pack, playbooks: [pack.playbooks[0], pack.playbooks[0]] })), /duplicate/)
  assert.throws(() => parseWorkflowPack('{invalid'))
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(installWorkflowPack(service, cwd, WORKFLOW_PACKS[3], aborted.signal), /abort/i)
  console.log('Workflow Packs: PASS (valid templates, argument binding, real playbook installation, matching/customized/invalid states, replay safety, atomic no-clobber writes, JSON import, cancellation)')
} finally { await rm(temp, { recursive: true, force: true }) }
process.exit(0)
