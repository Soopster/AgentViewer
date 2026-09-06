import assert from 'node:assert/strict'
import { deriveComposerRuntimeState, type ComposerRuntimeInput } from '../lib/composerRuntimeState'

const ready: ComposerRuntimeInput = {
  hasSession: true,
  sendState: 'idle',
  awaitingPersistedTurn: false,
  reattachedRunning: false,
  interrupting: false,
  liveStatus: null,
  hasLiveOutput: false,
  activeToolCount: 0,
  queuedCount: 0,
  queueDurability: 'durable',
}

assert.deepEqual(deriveComposerRuntimeState(ready), {
  phase: 'ready',
  transport: 'ready',
  transcript: 'idle',
  queue: 'empty',
  label: 'Ready',
  detail: 'The runtime is ready for a message.',
  tone: 'neutral',
})

assert.equal(deriveComposerRuntimeState({ ...ready, preparing: true }).phase, 'preparing')
assert.equal(deriveComposerRuntimeState({ ...ready, sendState: 'sending' }).phase, 'sending')
assert.equal(deriveComposerRuntimeState({ ...ready, sendState: 'sending', hasLiveOutput: true }).phase, 'streaming')
assert.equal(deriveComposerRuntimeState({ ...ready, sendState: 'sending', activeToolCount: 2 }).phase, 'streaming')
assert.equal(deriveComposerRuntimeState({ ...ready, sendState: 'sending', liveStatus: 'retrying' }).phase, 'retrying')
assert.equal(deriveComposerRuntimeState({ ...ready, sendState: 'sending', liveStatus: 'compacting' }).phase, 'compacting')
assert.equal(deriveComposerRuntimeState({ ...ready, awaitingPersistedTurn: true }).phase, 'reconciling')
assert.equal(deriveComposerRuntimeState({ ...ready, reattachedRunning: true }).phase, 'reattaching')
assert.equal(deriveComposerRuntimeState({ ...ready, interrupting: true }).phase, 'interrupting')
assert.equal(deriveComposerRuntimeState({ ...ready, sendState: 'error' }).phase, 'error')
assert.equal(deriveComposerRuntimeState({ ...ready, blockedReason: 'Authentication required.' }).transport, 'blocked')
assert.equal(deriveComposerRuntimeState({ ...ready, offline: true }).transcript, 'cached')

const memoryQueue = deriveComposerRuntimeState({
  ...ready,
  queuedCount: 2,
  queueDurability: 'memory-only',
})
assert.equal(memoryQueue.queue, 'memory-only')
assert.equal(memoryQueue.tone, 'warning')
assert.match(memoryQueue.detail, /Keep this tab open/)

const reconciling = deriveComposerRuntimeState({
  ...ready,
  awaitingPersistedTurn: true,
  queuedCount: 1,
})
assert.equal(reconciling.transport, 'ready')
assert.equal(reconciling.transcript, 'syncing')
assert.match(reconciling.detail, /One follow-up is queued/)

console.log('Composer runtime state smoke passed')
