// Approving a plan with a mode must carry that mode in the approval itself.
// Allowing ExitPlanMode leaves plan mode by restoring the mode from before it,
// which overwrote a separately sent setPermissionMode — "approve · auto-accept
// edits" then went on asking for every edit.
import assert from 'node:assert/strict'
import { claudePermissionDecision } from '../lib/sessionBackend'

const pending = { input: { plan: 'do it' }, suggestions: undefined }
const withMode = claudePermissionDecision('once', pending, 'acceptEdits')
assert.equal(withMode.behavior, 'allow')
assert.deepEqual((withMode as { updatedPermissions?: unknown }).updatedPermissions, [
  { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
], 'the chosen mode rides the approval as a session setMode update')

const plain = claudePermissionDecision('once', pending)
assert.equal((plain as { updatedPermissions?: unknown }).updatedPermissions, undefined, 'an ordinary allow changes no mode')

const rejected = claudePermissionDecision('reject', pending, 'acceptEdits')
assert.equal(rejected.behavior, 'deny', 'a rejected plan never switches mode')

console.log('Claude plan approval smoke passed')
process.exit(0)
