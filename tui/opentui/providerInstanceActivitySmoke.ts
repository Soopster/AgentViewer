import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'provider-instance-activity-')))
mkdirSync('.agent-viewer-data')
writeFileSync('.agent-viewer-data/provider-instances.json', JSON.stringify({ version: 1, instances: [
  { id: 'work', provider: 'codex', displayName: 'Work', environment: {} },
] }))
const { withProviderInstance } = await import('../../lib/providerInstances')
const { setRunningSession, clearRunningSession, listRunningSessionRefs, setWaitingSession, clearWaitingSession, listWaitingSessions } = await import('../../lib/sessionRuntime')
const { postViewerAttention, dismissViewerAttention } = await import('../../lib/viewerAttention')
const { readViewRuntimeActivity } = await import('../../lib/sessionActivity')
const id = 'instance-tagged-running'
let noteId = ''
try {
  await withProviderInstance('work', 'codex', async () => {
    setRunningSession(id, { provider: 'codex', interrupt: async () => {} })
    setWaitingSession({ sessionId: id, provider: 'codex', backgroundTasks: [{ id: 'task', type: 'agent', status: 'running', description: 'Fixture' }], sessionCrons: [] })
    const note = postViewerAttention({ sessionId: id, provider: 'codex', title: 'Scoped attention' })
    noteId = note.id
    assert.equal(note.providerInstanceId, 'work')
  })
  const activity = readViewRuntimeActivity()
  assert.equal(activity.running.find(entry => entry.sessionId === id)?.providerInstanceId, 'work', 'registry reads retain the identity captured at turn start')
  assert.equal(activity.waiting.find(entry => entry.sessionId === id)?.providerInstanceId, 'work')
  assert.equal(activity.attention.find(entry => entry.id === noteId)?.providerInstanceId, 'work')
  setWaitingSession({ sessionId: id, provider: 'codex', backgroundTasks: [{ id: 'task', type: 'agent', status: 'running', description: 'Updated outside the request context' }], sessionCrons: [] })
  assert.equal(listWaitingSessions().find(entry => entry.sessionId === id)?.providerInstanceId, 'work', 'background observations inherit their running owner')
  setRunningSession('default-running', { provider: 'codex', interrupt: async () => {} })
  assert.deepEqual(listRunningSessionRefs().find(entry => entry.sessionId === 'default-running'), { sessionId: 'default-running', provider: 'codex' }, 'default runtime wire shape stays compatible')
} finally {
  clearRunningSession(id); clearRunningSession('default-running'); clearWaitingSession(id)
  if (noteId) dismissViewerAttention(noteId)
}
console.log('Provider instance activity passed: running, waiting and attention metadata retain configured owners; defaults remain compatible')
