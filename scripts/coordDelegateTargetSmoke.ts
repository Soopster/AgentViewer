// `@reviewer check the diff` in a TUI delegation draft names the teammate —
// herdr's `agent start reviewer`. The server validates the name; the draft
// only splits it off, and must never do so for a follow-up already addressed.
import assert from 'node:assert/strict'
import { __delegateTargetForSmoke as delegateTarget } from '../tui/opentui/TeammatesPopover'

assert.deepEqual(delegateTarget('@reviewer check the diff', null), { detail: 'check the diff', to: 'auto', teammateName: 'reviewer' })
assert.deepEqual(delegateTarget('@Reviewer   check\nthe diff', null), { detail: 'check\nthe diff', to: 'auto', teammateName: 'reviewer' }, 'case folds, whitespace trims, body keeps its lines')
assert.deepEqual(delegateTarget('check the diff', null), { detail: 'check the diff', to: 'auto' }, 'no prefix: any available teammate')
assert.deepEqual(delegateTarget('@reviewer', null), { detail: '@reviewer', to: 'auto' }, 'a bare name with no task is not a delegation to that name')
assert.deepEqual(delegateTarget('@reviewer check', 'agent-3'), { detail: '@reviewer check', to: 'agent-3' }, 'an addressed follow-up is never re-targeted')
assert.deepEqual(delegateTarget('email @alice about it', null), { detail: 'email @alice about it', to: 'auto' }, 'only a leading @name counts')
console.log('Delegate target: @name prefix, case and whitespace, no-prefix default, addressed follow-ups untouched')
