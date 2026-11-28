// `seen` on the session inbox: recorded once, visible to a second reader, and never moves backwards.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(os.tmpdir(), 'session-seen-')))
const { updateSessionInboxState, readSessionInboxState } = await import('../lib/sessionInbox')

const args = { provider: 'claude' as const, sessionId: 's1' }
assert.equal(await readSessionInboxState('claude', 's1'), undefined)
const first = await updateSessionInboxState({ ...args, action: 'seen' })
assert.ok(first.seenAt && first.seenAt <= Date.now())
assert.equal((await readSessionInboxState('claude', 's1'))?.seenAt, first.seenAt)
await new Promise((resolve) => setTimeout(resolve, 5))
const second = await updateSessionInboxState({ ...args, action: 'seen' })
assert.ok(second.seenAt! > first.seenAt!, 'a later look moves seenAt forward')
const pinned = await updateSessionInboxState({ ...args, action: 'pin' })
assert.equal(pinned.seenAt, second.seenAt, 'other actions keep seenAt')
console.log('sessionSeenSmoke ok')
