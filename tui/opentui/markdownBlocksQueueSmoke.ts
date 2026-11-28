import assert from 'node:assert/strict'
const sent: Array<{ id: number; content: string }> = []
let instance: LocalWorker
class LocalWorker {
 onmessage: ((event: { data: unknown }) => void) | null = null
 onerror: ((event: { message: string }) => void) | null = null
 constructor() { instance = this }
 unref() {}
 terminate() {}
 postMessage(data: { id: number; content: string }) { sent.push(data) }
}
Object.assign(globalThis, { Worker: LocalWorker })
const { parseMarkdownBlocksAsync } = await import('./markdownBlocksWorkerClient')
const abort = new AbortController()
const first = parseMarkdownBlocksAsync('shared', abort.signal)
const second = parseMarkdownBlocksAsync('shared')
const rejected = assert.rejects(first, /aborted/)
abort.abort(); await rejected
assert.equal(sent.length, 1)
instance!.onmessage!({ data: { id: sent[0]!.id, blocks: [] } })
await second
const running = parseMarkdownBlocksAsync('running')
const cancelQueued = new AbortController()
const queued = parseMarkdownBlocksAsync('obsolete', cancelQueued.signal)
const cancelResult = assert.rejects(queued, /aborted/)
cancelQueued.abort(); await cancelResult
const next = parseMarkdownBlocksAsync('next')
assert.equal(sent.length, 2, 'only one parse can be in flight')
instance!.onmessage!({ data: { id: sent[1]!.id, blocks: [] } }); await running
assert.equal(sent[2]!.content, 'next', 'abandoned queued source is never parsed')
const failure = assert.rejects(next, /offline/)
instance!.onerror!({ message: 'offline' }); await failure
const retry = parseMarkdownBlocksAsync('retry')
instance!.onmessage!({ data: { id: sent[3]!.id, blocks: [] } }); await retry
console.log('Markdown queue passed: shared parse, independent abort, obsolete-work removal, serialization and recovery')
