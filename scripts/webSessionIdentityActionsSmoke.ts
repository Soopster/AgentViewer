import assert from 'node:assert/strict'
import { createSessionMetadataCallbacks, createSessionDeleteCallback, patchSessionList, removeSessionFromList } from '../components/session-catalog/actions'
import { catalogIncludesSessionInstance } from '../components/session-catalog/api'
import { runHandleDeleteSession } from '../components/message-view/actions/deleteSession'
import { sessionIdentityKey } from '../lib/sessionIdentity'
import { getProviderCapabilities } from '../lib/provider'
import type { Session } from '../lib/types'

const work: Session = { sessionId: 'shared/id', provider: 'opencode', providerInstanceId: 'work', summary: 'Work' }
const personal: Session = { ...work, providerInstanceId: 'personal', summary: 'Personal' }
const claude: Session = { ...work, provider: 'claude', providerInstanceId: undefined, summary: 'Claude' }
let sessions = [work, personal, claude]
const actions = createSessionMetadataCallbacks((target, patch) => { sessions = patchSessionList(sessions, target, patch) })
actions.onRename(work, 'Renamed work')
assert.equal(sessions[0]!.customTitle, 'Renamed work')
assert.equal(sessions[1], personal)
assert.equal(sessions[2], claude)
actions.onTag(personal, 'review')
assert.equal(sessions[1]!.tag, 'review')
assert.equal(sessions[0]!.tag, undefined)
const same = sessions
actions.onTag(personal, 'review')
assert.equal(sessions, same, 'unchanged edits preserve the list identity')
assert.equal(removeSessionFromList(sessions, { ...work, sessionId: 'absent' }), sessions)
assert.deepEqual(removeSessionFromList(sessions, work), [sessions[1], claude])
assert.equal(patchSessionList([claude], { sessionId: claude.sessionId, provider: 'claude', providerInstanceId: 'claude' }, { tag: 'default' })[0]!.tag, 'default')
const query = { provider: 'opencode' as const, providerInstanceId: 'personal', projectDir: null, includeWorktrees: true }
assert.equal(catalogIncludesSessionInstance(query, work), false)
assert.equal(catalogIncludesSessionInstance(query, personal), true)
assert.equal(catalogIncludesSessionInstance({ ...query, provider: 'all' }, work), true)

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const previousFetch = globalThis.fetch
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => true } })
  let complete!: (response: Response) => void
  let active: Session | null = work
  let cleared = 0
  let deleting = false
  let notice: string | null = null
  let error: string | null = null
  let delivered: Session | undefined
  const deleted = createSessionDeleteCallback({
    remove: target => { sessions = removeSessionFromList(sessions, target) },
    isActive: target => !!active && sessionIdentityKey(active) === sessionIdentityKey(target),
    clearActive: () => { active = null; cleared++ },
  })
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    assert.equal(url.pathname, '/api/sessions/shared%2Fid')
    assert.equal(url.searchParams.get('providerInstanceId'), 'work')
    assert.deepEqual(JSON.parse(String(init?.body)), { provider: 'opencode', providerInstanceId: 'work' })
    return new Promise<Response>(resolve => { complete = resolve })
  }
  const context = () => ({ session: work, deleting: false, sessionCapabilities: getProviderCapabilities('opencode'),
    setDeleting: value => { deleting = typeof value === 'function' ? value(deleting) : value },
    setSessionActionNotice: value => { notice = typeof value === 'function' ? value(notice) : value },
    setSessionActionError: value => { error = typeof value === 'function' ? value(error) : value },
    onDelete: target => { delivered = target; deleted(target) },
  }) satisfies Parameters<typeof runHandleDeleteSession>[0]
  const pending = runHandleDeleteSession(context())
  assert.equal(deleting, true)
  active = personal
  complete(new Response('{}'))
  await pending
  assert.equal(delivered, work, 'the full source identity reaches the completion callback')
  assert.equal(active, personal)
  assert.equal(cleared, 0)
  assert.equal(sessions.some(session => sessionIdentityKey(session) === sessionIdentityKey(work)), false)
  assert.equal(sessions.some(session => sessionIdentityKey(session) === sessionIdentityKey(personal)), true)
  assert.equal(error, null)
  assert.equal(notice, 'Session deleted.')
  assert.equal(deleting, false)

  // Failed requests leave the collection and navigation intact.
  sessions = [work, personal]
  active = work
  const failure = runHandleDeleteSession(context())
  complete(new Response('{}', { status: 500 }))
  await failure
  assert.equal(sessions.length, 2)
  assert.equal(active, work)
  assert.equal(deleting, false)
  assert.equal(error, 'HTTP 500')
  const success = runHandleDeleteSession(context())
  complete(new Response('{}'))
  await success
  assert.equal(active, null)
  assert.equal(cleared, 1)
} finally {
  globalThis.fetch = previousFetch
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
}
console.log('Web session identity actions: isolated metadata, scoped catalog mutations, delayed delete navigation, and request failure passed')
