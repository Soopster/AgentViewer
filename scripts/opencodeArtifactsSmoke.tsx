import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { McpArtifactLinks } from '../components/McpArtifacts'
import { toV1MessageBundles, type V2Message, type V2ToolContent } from '../lib/opencode2Mapping'
import { OpenCode2EventTranslator } from '../lib/opencode2Events'
import { mapOpenCodeMessagesToSessionMessages } from '../lib/opencodeMapper'
import { openCodeAttachmentImage, openCodeAttachmentText, withOpenCodeAttachments } from '../lib/opencodeAttachments'
import { buildThreadedMessages } from '../lib/threading'
import { formatTranscriptCards } from '../tui/format'
import type { ApiMessage, ToolResultBlock } from '../lib/types'

const image = 'data:image/png;base64,iVBORw0KGgo='
const files: V2ToolContent[] = [
  { type: 'text', text: 'Generated files.' },
  { type: 'file', uri: 'https://example.com/report.csv', mime: 'text/csv', name: 'report.csv' },
  { type: 'file', uri: 'file:///server/report.csv', mime: 'text/csv', name: 'local.csv' },
  { type: 'file', uri: image, mime: 'image/png', name: 'preview.png' },
]
const history: V2Message[] = [
  { id: 'user', type: 'user', text: 'Generate report', files: [{ data: 'iVBORw0KGgo=', mime: 'image/png', name: 'input.png' }], time: { created: 1 } },
  { id: 'assistant', type: 'assistant', time: { created: 2, completed: 3 }, content: [{
    type: 'tool', id: 'call', name: 'reports_generate', state: { status: 'completed', input: {}, content: files }, time: { created: 2, completed: 3 },
  }] },
]
const bundles = toV1MessageBundles(history, { sessionId: 'session' })
const tool = bundles[1]!.parts[0]!
assert.equal(tool.type, 'tool')
if (tool.type !== 'tool' || tool.state.status !== 'completed') throw new Error('missing completed tool')
assert.equal(tool.state.attachments?.length, 3)
const mapped = mapOpenCodeMessagesToSessionMessages(bundles)
const user = mapped[0]!.message as ApiMessage
assert.ok(Array.isArray(user.content) && user.content.some(block => block.type === 'image'), 'user image must retain preview data')
const results = mapped.flatMap(message => {
  const content = (message.message as ApiMessage).content
  return Array.isArray(content) ? content.filter((block): block is ToolResultBlock => block.type === 'tool_result') : []
})
const result = results[0]!
assert.deepEqual(result.resourceLinks?.map(link => link.uri), ['https://example.com/report.csv', 'file:///server/report.csv'])
assert.ok(Array.isArray(result.content) && result.content.some(block => block.type === 'image'))
assert.deepEqual(withOpenCodeAttachments({ type: 'tool_result', tool_use_id: 'call', content: tool.state.output, is_error: undefined }, tool.state.attachments),
  result, 'live tool results and mapped history must attach the same links and images')
const markup = renderToStaticMarkup(<McpArtifactLinks links={result.resourceLinks!} />)
assert.match(markup, /href="https:\/\/example.com\/report.csv"/)
assert.doesNotMatch(markup, /href="file:/)
assert.match(markup, /file:\/\/\/server\/report.csv/)
assert.match(JSON.stringify(formatTranscriptCards(buildThreadedMessages(mapped))), /artifact: report.csv/)
assert.equal(openCodeAttachmentImage({ url: 'data:image/svg+xml;base64,PHN2Zz4=', mime: 'image/svg+xml' }), null)
assert.equal(openCodeAttachmentImage({ url: image, mime: 'image/jpeg' }), null)
assert.equal(openCodeAttachmentImage({ url: 'https://example.com/image.png', mime: 'image/png' }), null)
assert.equal(openCodeAttachmentText({ url: image }), '[file] Inline attachment')

const translator = new OpenCode2EventTranslator()
const events = translator.translate({ type: 'session.tool.success', created: 3, data: {
  sessionID: 'session', assistantMessageID: 'assistant', id: 'call', content: files,
} })
const updated = events.find(event => event.payload.type === 'message.part.updated')!
assert.deepEqual((updated.payload as { properties: { part: { state: { attachments: unknown } } } }).properties.part.state.attachments,
  tool.state.attachments, 'live and persisted file ids and payloads must agree')

const failed = toV1MessageBundles([{ ...history[1]!, content: [{ type: 'tool', id: 'failed', name: 'reports_generate',
  state: { status: 'error', input: {}, error: { type: 'error', message: 'Partial failure' }, content: files }, time: { created: 2, completed: 3 },
}] }], { sessionId: 'session' })
const failure = mapOpenCodeMessagesToSessionMessages(failed).flatMap(message => {
  const content = (message.message as ApiMessage).content
  return Array.isArray(content) ? content.filter((block): block is ToolResultBlock => block.type === 'tool_result') : []
})[0]!
assert.equal(failure.is_error, true)
assert.equal(failure.resourceLinks?.length, 2)
console.log('OpenCode artifacts smoke passed: user/result images, web and TUI file links, local URI preservation, live/history parity, error attachments')
