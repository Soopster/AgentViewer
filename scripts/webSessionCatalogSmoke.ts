import assert from 'node:assert/strict'
import { stabilizeSessionIdentities, refreshOpenSessionMetadata } from '../components/session-catalog/model'
import { fetchSessionCatalog, sessionCatalogQueryKey, type SessionCatalogQuery } from '../components/session-catalog/api'
import { getProviderCapabilities } from '../lib/provider'
import type { Session } from '../lib/types'

const work: Session = { sessionId: 'shared', provider: 'codex', providerInstanceId: 'work', customTitle: 'Work', lastModified: 1 }
const personal: Session = { ...work, providerInstanceId: 'personal', customTitle: 'Personal' }
const original = [work, personal]
assert.equal(stabilizeSessionIdentities(original, original.map(value => ({ ...value }))), original)
const reordered = stabilizeSessionIdentities(original, [{ ...personal }, { ...work }])
assert.deepEqual(reordered, [personal, work])
assert.equal(reordered[0], personal)
assert.equal(reordered[1], work)
assert.notEqual(reordered, original, 'list reorder must not return the old array')
for (const change of [
  { customTitle: 'Updated without activity timestamp' }, { tag: 'updated' },
  { inbox: { pinnedAt: 42 } }, { providerAccentColor: '#fff' },
  { capabilities: getProviderCapabilities('codex') }, { transcriptUpdatedAt: 2 },
  { futureProviderField: { nested: true } },
]) {
  const incoming: Session = { ...work, ...change }
  const next = stabilizeSessionIdentities(original, [incoming, { ...personal }])
  assert.equal(next[0], incoming)
  assert.equal(next[1], personal)
}
assert.equal(refreshOpenSessionMetadata(original, original), original)
const missing = { ...work, sessionId: 'outside-scope' }
const updated = { ...work, customTitle: 'Updated' }
const tabs = refreshOpenSessionMetadata([personal, work, missing], [updated])
assert.equal(tabs[0], personal)
assert.equal(tabs[1], updated)
assert.equal(tabs[2], missing)
const query: SessionCatalogQuery = { provider: 'codex', providerInstanceId: 'work', projectDir: null, includeWorktrees: true }
assert.notEqual(sessionCatalogQueryKey(query), sessionCatalogQueryKey({ ...query, providerInstanceId: 'personal' }))
assert.equal(sessionCatalogQueryKey({ ...query, provider: 'all' }), sessionCatalogQueryKey({ ...query, provider: 'all', providerInstanceId: 'ignored' }))
assert.equal(sessionCatalogQueryKey(query), sessionCatalogQueryKey({ ...query, includeWorktrees: false }))
const previousFetch = globalThis.fetch
try {
  const abort = new AbortController()
  const seen: URL[] = []
  globalThis.fetch = async (input, init) => {
    assert.equal(init?.signal, abort.signal)
    seen.push(new URL(String(input), 'http://localhost'))
    return new Response(JSON.stringify({ sessions: [work] }), { headers: { 'Content-Type': 'application/json' } })
  }
  assert.deepEqual(await fetchSessionCatalog(query, abort.signal), [work])
  assert.equal(seen[0]!.searchParams.get('providerInstanceId'), 'work')
  assert.equal(seen[0]!.searchParams.get('limit'), '500')
  assert.equal(seen[0]!.searchParams.has('includeWorktrees'), false)
  await fetchSessionCatalog({ ...query, provider: 'all', projectDir: '/path with spaces', includeWorktrees: false }, abort.signal)
  assert.equal(seen[1]!.searchParams.has('providerInstanceId'), false)
  assert.equal(seen[1]!.searchParams.get('dir'), '/path with spaces')
  assert.equal(seen[1]!.searchParams.get('includeWorktrees'), 'false')
} finally { globalThis.fetch = previousFetch }
console.log('Web session catalog: full metadata, reorder, instance identity, stable tabs, and query contracts passed')
