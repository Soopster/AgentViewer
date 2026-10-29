import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { AsyncQuestionCard } from '../components/AsyncQuestionCard'
import { AskUserQuestionPicker } from '../components/message-view/AskUserQuestionPicker'
import { McpToolArtifacts } from '../components/McpArtifacts'
import { readAsyncQuestions, formatAsyncQuestionAnswers } from '../lib/asyncQuestions'
import type { PendingPermission } from '../lib/permissions'
import { normalizeCodexStreamArtifactMessage, normalizeCodexStreamThreadedMessage, mapCodexThreadToMessages } from '../lib/codexMapper'
import { readCodexMcpApp } from '../lib/codexMcpApps'
import { buildThreadedMessages, stripToolCallBlocks } from '../lib/threading'
import { formatTranscriptCards } from '../tui/format'
import type { Thread, ThreadItem } from '../lib/codex-schema/v2'

const question = { type: 'agentMessage', id: 'question', text: '', phase: 'final_answer', memoryCitation: null,
  delivery: 'async', questions: [{ title: 'Which layout?', options: ['Compact', 'Spacious'] }, { title: 'Anything else?', options: null }] } satisfies ThreadItem
const link = { type: 'resource_link', uri: 'https://example.com/report', name: 'Report' }
const call = { type: 'mcpToolCall', id: 'call', server: 'reports', tool: 'Read', status: 'completed', arguments: {},
  appContext: { connectorId: 'connector', linkId: 'account-1', resourceUri: 'ui://report', appName: 'Reports', actionName: 'Read' },
  mcpAppUi: { resourceUri: 'ui://report', preferredModelDisplayMode: 'fullscreen' }, mcpAppResourceUri: 'ui://legacy',
  pluginId: 'plugin', readOnlyHint: true, result: { content: [{ type: 'text', text: 'Ready' }, link],
    structuredContent: { rows: 3 }, _meta: { ui: { resourceUri: 'ui://fallback' }, private: 'app-data' } }, error: null, durationMs: 1 } satisfies ThreadItem
// Only the turn fields used by the mapper are necessary for this fixture.
const thread = { id: 'thread', turns: [{ id: 'turn', items: [question, call], startedAt: 1, completedAt: 2 }] } as Thread
const live = (item: ThreadItem, completed = true) => normalizeCodexStreamThreadedMessage({
  type: completed ? 'codex_item_completed' : 'codex_item_started', threadId: 'thread', turnId: 'turn', item,
})!
const webQuestion = normalizeCodexStreamArtifactMessage({ type: 'codex_item_completed', threadId: 'thread', turnId: 'turn', item: { ...question, text: 'Please choose.' } })!
assert.equal(webQuestion.blocks.length, 1)
assert.equal(webQuestion.blocks[0].type, 'tool_thread', 'web completion must retain questions without duplicating separately streamed prose')
assert.equal(normalizeCodexStreamArtifactMessage({ type: 'codex_item_completed', threadId: 'thread', turnId: 'turn', item: { ...question, text: 'Prose only', questions: null } }), null)
const persisted = buildThreadedMessages(mapCodexThreadToMessages(thread))
const questionMessage = live(question)
assert.equal(questionMessage.blocks[0].type, 'tool_thread', 'question-only messages must survive')
const questionBlock = questionMessage.blocks[0]
assert.ok(questionBlock.type === 'tool_thread')
const questions = readAsyncQuestions(questionBlock.toolUse.input)
assert.deepEqual(questions.map(question => question.id), ['question:0', 'question:1'])
assert.deepEqual(questions[1].options, [], 'null options allow a freeform reply')
assert.equal(formatAsyncQuestionAnswers(questions, { 'question:0': ['Compact'], 'question:1': ['Custom'] }), 'Which layout?\nCompact\n\nAnything else?\nCustom')
assert.deepEqual(stripToolCallBlocks([questionMessage]), [questionMessage], 'tool visibility must not hide questions')
assert.equal(stripToolCallBlocks([live(call)]).length, 0)
assert.deepEqual(persisted[0].blocks, questionMessage.blocks, 'live/history question parity')
for (const text of ['', 'Please choose.']) {
  const message = live({ ...question, text })
  for (const density of ['dense', 'balanced', 'comfortable'] as const) {
    const card = formatTranscriptCards([message], density)[0]
    assert.equal(card.autoFold, false)
    assert.equal(card.pending, undefined, 'async questions are not blocking tool calls')
    assert.equal(card.markdownContent, undefined, 'markdown must not replace questions with only prose')
    assert.equal(card.asyncQuestions?.length, 2)
    assert.match(card.lines.map(line => line.text).join('\n'), /Compact/)
    assert.match(card.lines.map(line => line.text).join('\n'), /Anything else/)
  }
}
const questionHtml = renderToStaticMarkup(<AsyncQuestionCard toolUse={questionBlock.toolUse} />)
assert.match(questionHtml, /Which layout/)
assert.match(questionHtml, /Spacious/)
assert.match(questionHtml, /Answer: Anything else/)
assert.match(questionHtml, /Use answers in composer/)
// Codex's blocking requestUserInput renders as the CLI's tabbed questionnaire:
// every question gets a tab, but only the active question's options are drawn.
const codexQuestionnaire: PendingPermission = {
  id: 'codex-question', provider: 'codex', toolName: 'item/tool/requestUserInput', title: 'Codex asks',
  questions: [
    { id: 'first', header: 'First', question: 'Pick one', options: [{ label: 'Alpha' }, { label: 'Beta' }] },
    { id: 'second', header: 'Second', question: 'Pick another', options: [{ label: 'Gamma' }] },
  ],
}
const codexQuestionnaireHtml = renderToStaticMarkup(
  <AskUserQuestionPicker permission={codexQuestionnaire} busy={false} onSubmit={() => {}} onCancel={() => {}} />,
)
assert.match(codexQuestionnaireHtml, /First/)
assert.match(codexQuestionnaireHtml, /Second/)
assert.match(codexQuestionnaireHtml, /Submit/)
assert.match(codexQuestionnaireHtml, /Pick one/)
assert.match(codexQuestionnaireHtml, /Alpha/)
assert.doesNotMatch(codexQuestionnaireHtml, /Pick another/)
assert.doesNotMatch(codexQuestionnaireHtml, /Gamma/)
assert.match(codexQuestionnaireHtml, /Select an option to continue/)
const tool = live(call).blocks[0]
assert.ok(tool.type === 'tool_thread')
assert.deepEqual(tool.toolUse.input, {}, 'host routing fields must not pollute tool arguments')
assert.equal(tool.toolUse.mcp?.originCallId, call.id)
assert.deepEqual(tool.toolUse.mcp?.app, call.mcpAppUi)
assert.equal(tool.toolUse.mcp?.appContext?.linkId, 'account-1')
assert.deepEqual(tool.result?.structuredContent, { rows: 3 })
assert.deepEqual(tool.result?.mcpMeta, call.result._meta)
assert.deepEqual(tool.result?.resourceLinks, [link])
assert.deepEqual(live(call, false).blocks[0].type === 'tool_thread' && (live(call, false).blocks[0] as typeof tool).result, null)
const toolCard = formatTranscriptCards([live(call)])[0]
assert.match(toolCard.expandedLines.map(line => line.text).join('\n'), /MCP App \(fullscreen\): ui:\/\/report/)
assert.match(toolCard.expandedLines.map(line => line.text).join('\n'), /artifact: Report/)
assert.match(renderToStaticMarkup(<McpToolArtifacts result={tool.result!} input={{}} session={{ sessionId: 'thread', provider: 'codex' }}
  serverName="reports" toolName="Read" originCallId="call" />), /Open MCP App preview/)
assert.deepEqual(readAsyncQuestions({ asyncUserInput: true, questions: [null, {}, { id: 'x', question: 'q', options: [null] }] }),
  [{ id: 'x', question: 'q', options: [], allowFreeform: true }])

let reads = 0
let catalogs = 0
let currentCall: typeof call | ThreadItem = call
let resourceOrigin: string | null = 'call'
const dependencies: NonNullable<Parameters<typeof readCodexMcpApp>[4]> = {
  readThread: async () => ({ ...thread, turns: [{ ...thread.turns[0], items: [currentCall] }] }),
  list: async params => {
    catalogs++
    assert.equal(params.threadId, 'thread')
    assert.equal(params.serverName, 'reports')
    return { data: params.cursor ? [{ name: 'reports', runtimeStatus: 'connected', pluginId: null, httpOrigin: null, serverInfo: null, serverCapabilities: null, toolsError: null, resources: [], resourceTemplates: [], authStatus: 'unknown', tools: { Read: { name: 'Read', inputSchema: {}, _meta: { ui: { resourceUri: 'ui://catalog' } } } } }] : [],
      nextCursor: params.cursor ? null : 'next' }
  },
  readResource: async params => {
    reads++
    assert.equal(params.threadId, 'thread')
    assert.equal(params.originCallId, 'call')
    assert.equal(params.server, 'reports')
    assert.equal(params.target, undefined, 'origin call retains account provenance')
    return { originCallId: resourceOrigin, contents: [{ uri: params.uri, mimeType: 'text/html;profile=mcp-app', text: '<h1>Scoped app</h1>' }] }
  },
}
const open = () => readCodexMcpApp('thread', 'reports', 'Read', 'call', dependencies)
const app = await open()
assert.equal(app.available && app.uri, 'ui://report')
assert.equal(app.available && app.preferredModelDisplayMode, 'fullscreen')
assert.match(app.available ? app.html : '', /connect-src 'none'/)
assert.equal(catalogs, 0, 'captured descriptor needs no catalog lookup')
currentCall = { ...call, mcpAppUi: null }
assert.equal((await open()).available, true)
currentCall = { ...call, mcpAppUi: null, mcpAppResourceUri: undefined }
assert.equal((await open() as { uri: string }).uri, 'ui://fallback')
currentCall = { ...call, mcpAppUi: null, mcpAppResourceUri: undefined, result: null }
assert.equal((await open() as { uri: string }).uri, 'ui://catalog')
assert.equal(catalogs, 2, 'catalog fallback must page')
const before = reads
await assert.rejects(readCodexMcpApp('thread', 'other-server', 'Read', 'call', dependencies), /originating/)
await assert.rejects(readCodexMcpApp('thread', 'reports', 'other-tool', 'call', dependencies), /originating/)
await assert.rejects(readCodexMcpApp('thread', 'reports', 'Read', 'foreign-call', dependencies), /originating/)
assert.equal(reads, before)
currentCall = call
resourceOrigin = 'foreign-call'
await assert.rejects(open(), /different tool call/)
resourceOrigin = null
assert.equal((await open()).available, true, 'older unannotated responses remain compatible')
console.log('Codex new-schema questions, transcript parity, MCP sidecars, scoped resources, and UI rendering passed')
