import assert from 'node:assert/strict'
import type { CopilotSession } from '@github/copilot-sdk'
import { copilotSessionConfigOverrides, rewindCopilotSessionFiles } from '../lib/copilotClient'
import { COPILOT_CAPABILITIES } from '../lib/provider'

type RewindRpc = Pick<CopilotSession, 'rpc'>

function fakeSession(options: {
  available?: boolean
  reason?: 'session-busy' | 'file-change-tracking-disabled' | 'unsupported-remote-session'
  outcome?: 'success' | 'checkpoint-cleanup-failed' | 'snapshot-prune-failed' | 'truncation-failed'
}) {
  let rewindCalls = 0
  const session = {
    rpc: {
      history: {
        previewRewind: async ({ eventId }: { eventId: string }) => {
          assert.equal(eventId, 'user-event-1')
          return {
            available: options.available ?? true,
            reason: options.reason,
            fileCount: 2,
            files: [
              { path: '/repo/a.ts', changeType: 'modified', linesAdded: 2, linesRemoved: 1 },
              { path: '/repo/b.ts', changeType: 'created', linesAdded: 4, linesRemoved: 0 },
            ],
          }
        },
        rewind: async ({ eventId, mode }: { eventId: string; mode: string }) => {
          rewindCalls += 1
          assert.equal(eventId, 'user-event-1')
          assert.equal(mode, 'conversation-and-files')
          return {
            outcome: options.outcome ?? 'success',
            restoredFiles: ['/repo/a.ts', '/repo/b.ts'],
            skippedFiles: [],
            ...((options.outcome === 'checkpoint-cleanup-failed' || options.outcome === 'snapshot-prune-failed')
              ? { error: 'cleanup warning' }
              : options.outcome === 'truncation-failed'
                ? { error: 'truncate failed' }
                : {}),
          }
        },
      },
    },
  } as unknown as RewindRpc
  return { session, rewindCalls: () => rewindCalls }
}

assert.equal(COPILOT_CAPABILITIES.fileRewind, true)
assert.equal(copilotSessionConfigOverrides().enableFileChangeTracking, true)

const previewSession = fakeSession({})
assert.deepEqual(await rewindCopilotSessionFiles(previewSession.session, 'user-event-1', true), {
  mode: 'rewind',
  canRewind: true,
  filesChanged: ['/repo/a.ts', '/repo/b.ts'],
})
assert.equal(previewSession.rewindCalls(), 0)

const applySession = fakeSession({ outcome: 'success' })
assert.deepEqual(await rewindCopilotSessionFiles(applySession.session, 'user-event-1', false), {
  mode: 'rewind',
  canRewind: true,
  filesChanged: ['/repo/a.ts', '/repo/b.ts'],
  outcome: 'success',
})
assert.equal(applySession.rewindCalls(), 1)

const legacySession = fakeSession({ available: false, reason: 'file-change-tracking-disabled' })
const unavailable = await rewindCopilotSessionFiles(legacySession.session, 'user-event-1', true)
assert.equal(unavailable.canRewind, false)
assert.match(unavailable.error ?? '', /predates file-change tracking/i)
assert.equal(legacySession.rewindCalls(), 0)

const cleanupSession = fakeSession({ outcome: 'snapshot-prune-failed' })
const cleanup = await rewindCopilotSessionFiles(cleanupSession.session, 'user-event-1', false)
assert.equal(cleanup.canRewind, true)
assert.equal(cleanup.warning, 'cleanup warning')

const failedSession = fakeSession({ outcome: 'truncation-failed' })
const failed = await rewindCopilotSessionFiles(failedSession.session, 'user-event-1', false)
assert.equal(failed.canRewind, false)
assert.equal(failed.error, 'truncate failed')

console.log('copilot rewind smoke passed')
