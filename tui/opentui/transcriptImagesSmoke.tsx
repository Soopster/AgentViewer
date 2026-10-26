/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { formatTranscriptCard, reformatTranscriptCardDensity } from '../format'
import type { ThreadedMessage } from '../../lib/threading'
import { PROVIDER_IDS } from '../../lib/extensions/providers/catalog'
import { buildThreadedMessages } from '../../lib/threading'
import { mapAcpBufferedMessage } from '../../lib/acpMapper'
import { mapCopilotEventsToSessionMessages } from '../../lib/copilotMapper'
import type { AcpBufferedMessage } from '../../lib/acpClientPool'
import type { SessionEvent } from '@github/copilot-sdk'
import { TranscriptImages } from './TranscriptImages'
import { testRender, act } from './testRender'

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg=='
const source = `data:image/png;base64,${data}`
const message = { uuid: 'image-test', role: 'user', blocks: [{ type: 'text', text: `Look at this\n[image] ${source}` }] } as ThreadedMessage
const card = formatTranscriptCard(message)
assert.deepEqual(card.images, [source])
assert.ok(!JSON.stringify([card.lines, card.expandedLines, card.searchText, card.markdownContent]).includes(data))
assert.ok(!JSON.stringify(reformatTranscriptCardDensity(message, 'dense', card).lines).includes(data))
const native = formatTranscriptCard({ ...message, blocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] })
assert.deepEqual(native.images, [source])
// Every registered provider shares the same renderer for prompt and tool images.
for (const provider of PROVIDER_IDS) {
  const prompt = formatTranscriptCard({ ...message, provider, blocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] })
  assert.deepEqual(prompt.images, [source], `${provider}: prompt preview`)
  const tool = formatTranscriptCard({ ...message, provider, role: 'assistant', blocks: [{ type: 'tool_thread', toolUse: { type: 'tool_use', id: 'tool', name: 'Read', input: {} }, result: { type: 'tool_result', tool_use_id: 'tool', content: [{ type: 'text', text: 'Image read' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] } }] })
  assert.deepEqual(tool.images, [source], `${provider}: tool preview`)
  assert.ok(!JSON.stringify([tool.lines, tool.expandedLines, tool.searchText]).includes(data))
}
for (const provider of ['claude-acp', 'codex-acp', 'acp'] as const) {
  const mapped = mapAcpBufferedMessage('s', provider, { index: 0, receivedAt: 1, message: { kind: 'session_update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'image', mimeType: 'image/png', data } } } } as AcpBufferedMessage)
  assert.ok(mapped)
  assert.deepEqual(formatTranscriptCard(buildThreadedMessages([mapped])[0]!).images, [source])
  const updates = [
    { sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read', status: 'in_progress' },
    { sessionUpdate: 'tool_call_update', toolCallId: 'read', status: 'completed', content: [{ type: 'content', content: { type: 'image', mimeType: 'image/png', data } }] },
  ]
  const toolMessages = updates.map((update, index) => mapAcpBufferedMessage('s', provider, { index: index + 1, receivedAt: index + 2, message: { kind: 'session_update', update } } as AcpBufferedMessage)).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  assert.deepEqual(formatTranscriptCard(buildThreadedMessages(toolMessages)[0]!).images, [source], `${provider}: mapped tool image`)
}
const copilot = mapCopilotEventsToSessionMessages('s', [
  { id: 'asset', type: 'session.binary_asset', timestamp: new Date(1).toISOString(), data: { assetId: 'asset-1', type: 'image', mimeType: 'image/png', data, byteLength: 10 } },
  { id: 'prompt', type: 'user.message', timestamp: new Date(2).toISOString(), data: { content: 'Look', attachments: [{ type: 'blob', mimeType: 'image/png', assetId: 'asset-1' }] } },
  { id: 'tool', type: 'assistant.message', timestamp: new Date(3).toISOString(), data: { content: '', toolRequests: [{ toolCallId: 'call', name: 'Read', arguments: {} }] } },
  { id: 'result', type: 'tool.execution_complete', timestamp: new Date(4).toISOString(), data: { toolCallId: 'call', success: true, result: { content: 'Image', contents: [{ type: 'image', mimeType: 'image/png', data }] } } },
] as SessionEvent[])
const copilotCards = buildThreadedMessages(copilot).map(entry => formatTranscriptCard(entry))
assert.equal(copilotCards.filter(card => card.images?.includes(source)).length, 2, 'Copilot persisted blobs and tool results')
const setup = await testRender(<TranscriptImages sources={[source]} width={40} muted="#888888" />, { width: 50, height: 16 })
await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); await setup.flush() })
const node = setup.renderer.root.getChildren()[0]?.getChildren()[0] as unknown as { image?: unknown; loadError?: unknown; height: number }
assert.ok(node?.image, `Image failed to decode: ${String(node?.loadError)}`)
assert.equal(node.height, 12)
assert.ok(!setup.captureCharFrame().includes(data))
act(() => { setup.renderer.destroy() })
console.log('transcriptImagesSmoke: ok')
