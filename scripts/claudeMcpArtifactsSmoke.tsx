import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createClaudeArtifactStore } from '../lib/claudeArtifactStore'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { McpArtifactLinks } from '../components/McpArtifacts'
import { attachMcpResultSidecar, mcpAppHtml, mcpAppResourceUri, mcpArtifactHref, mcpResourceLinks } from '../lib/mcpArtifacts'
import { readClaudeMcpApp } from '../lib/claudeMcpApps'
import { applyClaudeLiveToolResults, extractClaudeStreamToolResults, normalizeClaudeHistoryMessages, normalizeClaudeStreamThreadedMessage } from '../lib/claudeMapper'
import { extractClaudeElicitation, parseMcpElicitationQuestions } from '../lib/permissions'
import { formatClaudeRuntimeDetailLines, getClaudeBackgroundTasks } from '../lib/claudeSdkFeatures'
import { buildThreadedMessages } from '../lib/threading'
import { formatMessageExpanded, formatTranscriptCards } from '../tui/format'
import type { ToolResultBlock, SystemMessagePayload } from '../lib/types'

const link = { type: 'resource_link', uri: 'https://example.com/report.csv', name: 'report.csv', title: 'Report', mimeType: 'text/csv' }
const result: ToolResultBlock = { type: 'tool_result', tool_use_id: 'call', content: 'Generated report.' }
const sidecar = { resourceLinks: [link], structuredContent: { rows: 3 }, _meta: { ui: { resourceUri: 'ui://report' } } }
const raw = { type: 'user', uuid: 'result', session_id: 'session', message: { role: 'user', content: [result] }, tool_use_result: sidecar }
const live = extractClaudeStreamToolResults(raw)[0]
assert.deepEqual(live.resourceLinks, [link])
assert.deepEqual(live.structuredContent, { rows: 3 })
assert.deepEqual(live.mcpMeta, sidecar._meta)
const history = normalizeClaudeHistoryMessages([raw])
const historyResult = (history[0].message as { content: ToolResultBlock[] }).content[0]
assert.deepEqual(JSON.parse(JSON.stringify(historyResult)), JSON.parse(JSON.stringify(live)), 'reload must preserve live artifacts and app data')
assert.equal(attachMcpResultSidecar([result, { ...result, tool_use_id: 'other' }], sidecar)[0].resourceLinks, undefined, 'ambiguous sidecars must not be attached to multiple calls')
assert.equal(mcpResourceLinks([link, link]).length, 1)
assert.equal(mcpResourceLinks(Array.from({ length: 70 }, (_, i) => ({ ...link, uri: `https://example.com/${i}` }))).length, 50)
assert.equal(mcpResourceLinks([{ ...link, uri: 'https://example.com/\nattack' }]).length, 0)
for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://user:pass@example.com', 'mcp://report']) assert.equal(mcpArtifactHref(uri), undefined)
assert.equal(mcpArtifactHref(link.uri), link.uri)
const markup = renderToStaticMarkup(<McpArtifactLinks links={mcpResourceLinks([link, { ...link, uri: 'javascript:alert(1)', name: '<script>bad</script>', title: '<script>bad</script>' }])} />)
assert.match(markup, /href="https:\/\/example.com\/report.csv"/)
assert.match(markup, /rel="noopener noreferrer"/)
assert.doesNotMatch(markup, /href="javascript:|<script>/)
assert.match(markup, /&lt;script&gt;/)

const assistant = { type: 'assistant', uuid: 'assistant', session_id: 'session', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call', name: 'mcp__reports__generate', input: {} }] } }
const threaded = buildThreadedMessages(normalizeClaudeHistoryMessages([assistant, raw]))
const pendingThreads = buildThreadedMessages(normalizeClaudeHistoryMessages([assistant, { ...assistant, uuid: 'unrelated', message: { role: 'assistant', content: [{ type: 'text', text: 'Other row' }] } }]))
const updatedThreads = applyClaudeLiveToolResults(pendingThreads, [live])
assert.notEqual(updatedThreads[0], pendingThreads[0])
assert.equal(updatedThreads[1], pendingThreads[1], 'unrelated rows must retain their identity')
assert.equal(applyClaudeLiveToolResults(updatedThreads, [live]), updatedThreads)
assert.equal(applyClaudeLiveToolResults(pendingThreads, [{ ...live, tool_use_id: 'missing' }]), pendingThreads)

assert.match(JSON.stringify(formatTranscriptCards(threaded)), /artifact: Report/)
assert.match(JSON.stringify(formatMessageExpanded(threaded, 'assistant')), /https:\/\/example.com\/report.csv/)
const notification = normalizeClaudeStreamThreadedMessage({ type: 'system', subtype: 'task_notification', uuid: 'notify', session_id: 'session', resource_links: [link], summary: 'Done' })!
assert.match(JSON.stringify(formatTranscriptCards([notification])), /artifact: Report/)

const properties = JSON.parse('{"2":{"type":"string"},"1":{"type":"string"},"last":{"type":"boolean"}}')
const schema = { type: 'object', properties, required: ['1'] }
const order = ['last', '2', 'last', 'missing', '__proto__']
const questions = parseMcpElicitationQuestions(schema, order)!
assert.deepEqual(questions.map(q => q.id), ['last', '2', '1'])
assert.equal(questions.find(q => q.id === '1')?.required, true)
const pending = extractClaudeElicitation({ type: 'claude_elicitation', event: { type: 'elicitation.requested', data: { requestId: 'request', requestedSchema: schema, property_order: order } } })!
assert.deepEqual(pending.questions?.map(q => q.id), ['last', '2', '1'])
const taskPayload: SystemMessagePayload = { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'task', task_type: 'agent', description: 'Review', subagent_type: 'reviewer', parent_task_id: 'parent', run_id: 'run' }] }
assert.equal(getClaudeBackgroundTasks(taskPayload)[0].subagent_type, 'reviewer')
assert.match(formatClaudeRuntimeDetailLines(taskPayload).join('\n'), /reviewer.*from parent/)
for (const enabled of [true, false]) {
  const rate = normalizeClaudeStreamThreadedMessage({ type: 'rate_limit_event', uuid: 'rate', session_id: 'session', rate_limit_info: { status: 'allowed_warning', overageEnabled: enabled } })!
  const expected = enabled ? 'extra usage enabled' : 'extra usage disabled'
  assert.ok(JSON.stringify(formatTranscriptCards([rate])).includes(expected))
  assert.ok(JSON.stringify(formatMessageExpanded([rate], 'rate')).includes(`extra usage: ${enabled ? 'enabled' : 'disabled'}`))
}

assert.equal(mcpAppResourceUri({ ui: { resourceUri: 'https://example.com' } }), undefined)
assert.equal(mcpAppResourceUri({ 'ui/resourceUri': 'ui://old' }), 'ui://old')
const html = mcpAppHtml({ contents: [{ uri: 'ui://report', mimeType: 'text/html;profile=mcp-app', text: '<h1>Report</h1><script>/* local app */</script>' }] }, 'ui://report')
assert.ok(html.startsWith('<meta http-equiv="Content-Security-Policy"'))
assert.match(html, /connect-src 'none'/)
assert.match(html, /form-action 'none'/)
assert.throws(() => mcpAppHtml({ contents: [{ uri: 'ui://other', mimeType: 'text/html', text: 'wrong resource' }] }, 'ui://report'))
assert.match(mcpAppHtml({ contents: [{ uri: 'ui://report', mimeType: 'text/html', blob: btoa('<p>hello</p>') }] }, 'ui://report'), /<p>hello/)
assert.throws(() => mcpAppHtml({ contents: [{ uri: 'ui://report', mimeType: 'text/html', text: 'x'.repeat(2_000_001) }] }, 'ui://report'))
let reads = 0
const query = {
  mcpServerStatus: async () => [{ name: 'reports', status: 'connected' as const, tools: [{ name: 'generate', _meta: sidecar._meta }] }],
  readMcpResource: async (server: string, uri: string) => {
    reads++
    assert.equal(server, 'reports'); assert.equal(uri, 'ui://report')
    return { contents: [{ uri, mimeType: 'text/html', text: '<p>report</p>' }] }
  },
}
assert.deepEqual(await readClaudeMcpApp(query, 'reports', 'unknown'), { available: false })
assert.deepEqual(await readClaudeMcpApp(query, 'unknown', 'generate'), { available: false })
assert.equal(reads, 0)
assert.equal((await readClaudeMcpApp(query, 'reports', 'generate')).available, true)
assert.equal(reads, 1)
assert.deepEqual(await readClaudeMcpApp({ ...query, mcpServerStatus: async () => [{ name: 'reports', status: 'disabled' as const, tools: [{ name: 'generate', _meta: sidecar._meta }] }] }, 'reports', 'generate'), { available: false })
assert.equal(reads, 1, 'disabled servers must never be read')
const directory = await mkdtemp(path.join(tmpdir(), 'claude-artifacts-smoke-'))
try {
  const store = createClaudeArtifactStore(directory)
  const sdkRead = normalizeClaudeHistoryMessages([{ ...raw, tool_use_result: undefined }])
  const before = await store.token('session', 'primary')
  await Promise.all([
    store.capture('session', raw, 'primary'),
    store.capture('session', { ...raw, message: { ...raw.message, content: [{ ...result, tool_use_id: 'second' }] } }, 'primary'),
  ])
  assert.notEqual(await store.token('session', 'primary'), before)
  // Fresh store simulates a process restart; the SDK read has dropped sidecars.
  const restarted = createClaudeArtifactStore(directory)
  const hydrated = await restarted.hydrate('session', sdkRead, 'primary')
  assert.deepEqual((hydrated[0].message as { content: ToolResultBlock[] }).content[0].resourceLinks, [link])
  assert.deepEqual((hydrated[0].message as { content: ToolResultBlock[] }).content[0].structuredContent, { rows: 3 })
  const isolated = await restarted.hydrate('session', sdkRead, 'secondary')
  assert.equal((isolated[0].message as { content: ToolResultBlock[] }).content[0].resourceLinks, undefined)
  const concurrent = normalizeClaudeHistoryMessages([{ ...raw, tool_use_result: undefined, message: { ...raw.message, content: [{ ...result, tool_use_id: 'second' }] } }])
  assert.deepEqual(((await restarted.hydrate('session', concurrent, 'primary'))[0].message as { content: ToolResultBlock[] }).content[0].resourceLinks, [link])
  assert.equal((await stat(directory)).mode & 0o077, 0)
} finally { await rm(directory, { recursive: true, force: true }) }
console.log('Claude MCP artifacts, app resource isolation, form order, task labels, and extra usage smoke passed')
