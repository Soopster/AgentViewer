import assert from 'node:assert/strict'
import { createOpenCode2Clients } from '../lib/opencode2Client'
import { createOpencodeClient } from '@opencode-ai/sdk'
import { createOpencodeClient as createV1QuestionClient } from '@opencode-ai/sdk/v2'
import { getOpenCodeSessionMessages } from '../lib/opencodeSessions'
import { openCodeMessagesSignature } from '../lib/opencodeMapper'
import type { V2Message } from '../lib/opencode2Mapping'

const messages: V2Message[] = Array.from({ length: 2405 }, (_, index) => ({
  id: `message-${index}`, type: 'user', text: `Message ${index}`, time: { created: index + 1 },
}))
const newestFirst = [...messages].reverse()
const requests: URL[] = []
let repeatCursor = false
const fetchHistory: typeof fetch = async (input, init) => {
  const url = new URL(new Request(input, init).url)
  requests.push(url)
  const cursor = url.searchParams.get('cursor')
  assert.equal(url.searchParams.get('limit'), '200')
  assert.equal(url.searchParams.get('order'), cursor ? null : 'desc')
  const offset = Number(cursor ?? 0)
  const data = newestFirst.slice(offset, offset + 200)
  return Response.json({ data, cursor: { next: repeatCursor ? '200'
    : offset + data.length < newestFirst.length ? String(offset + data.length) : null } })
}
const { client } = createOpenCode2Clients({ baseUrl: 'http://history.invalid', fetch: fetchHistory })
const response = await client.session.messages({ path: { id: 'session' } })
const bundles = (Array.isArray(response) ? response : response.data)!
assert.equal(bundles.length, messages.length, 'history must include messages beyond the old 2000 cap')
assert.deepEqual(bundles.map(bundle => bundle.info.id), messages.map(message => message.id), 'pages must be ordered oldest-first')
assert.equal(requests.length, 13)
const again = await client.session.messages({ path: { id: 'session' } })
assert.equal(again, response, 'an idle tail verification must reuse normalized bundles')
assert.equal(requests.length, 14, 'warm reads request just the newest page')
const originalSignature = openCodeMessagesSignature(bundles)
newestFirst[2000]!.text = 'An older message edited while disconnected'
await client.global.event() // opening/reopening the event transport invalidates old prefixes
const beforeReconnectRead = requests.length
const reconnected = await client.session.messages({ path: { id: 'session' } })
const reconnectedBundles = (Array.isArray(reconnected) ? reconnected : reconnected.data)!
assert.equal(requests.length - beforeReconnectRead, 13)
assert.notEqual(openCodeMessagesSignature(reconnectedBundles), originalSignature,
  'historical changes must invalidate mapped messages even when the last message and length are unchanged')
repeatCursor = true
const broken = createOpenCode2Clients({ baseUrl: 'http://history.invalid', fetch: fetchHistory }).client
await assert.rejects(broken.session.messages({ path: { id: 'session' } }), /repeated.*cursor/)
const v1 = createOpencodeClient({ baseUrl: 'http://history.invalid', fetch: async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  assert.equal(url.searchParams.get('limit'), null, 'v1 must not impose the old 2000-message cap')
  return Response.json(bundles)
} })
globalThis.__agentViewerOpenCodeRuntimePromise = Promise.resolve({
  client: v1, clientV2: createV1QuestionClient({ baseUrl: 'http://unused.invalid' }), server: null, generation: 1,
})
assert.equal((await getOpenCodeSessionMessages('session')).length, 2405)
console.log('OpenCode history smoke passed: 2405 messages, bounded v2 pages, uncapped v1 reads, ordering, repeated-cursor rejection')
