import assert from 'node:assert/strict'
import { createEventBus, type AgentSession } from '@earendil-works/pi-coding-agent'
import { OpenCode2EventTranslator } from '../lib/opencode2Events'
import { extractPiQuestion } from '../lib/permissions'
import { createPiUiBridge, installPiUiHandler, listPendingPiUiPayloads, respondPiUiPermission, respondPiUiQuestion } from '../lib/piExtensionUi'
import { observePiMcpStatus, readPiMcpStatus } from '../lib/piMcpDiagnostics'
import { piSubagentRows } from '../lib/piSubagents'
import { DEFAULT_PLUGIN_SETTINGS, applyPluginSettings, decodePluginSettings, isPluginEnabled, withPluginEnabled } from '../lib/plugins/enablement'
import { loadPiPluginTools } from '../lib/plugins/piTools'
import { isTabbedQuestionnaire } from '../lib/questionnaire'
import { beginSessionCompaction, readSessionCompaction } from '../lib/sessionCompaction'
import { behavior as webResults } from '../plugins/web-results/server'

applyPluginSettings(decodePluginSettings({ version: 1, disabled: [] }))
assert.equal(isPluginEnabled('pi-interview'), false, 'existing settings must preserve opt-in')
const settings = withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'pi-interview', true)
applyPluginSettings(decodePluginSettings(JSON.parse(JSON.stringify(settings))))
assert.equal(isPluginEnabled('pi-interview'), true)

const active = new Set<string>()
const frames: string[] = []
const remove = installPiUiHandler('interview-smoke', createPiUiBridge('interview-smoke', frame => frames.push(frame), active))
const [tool] = await loadPiPluginTools(['pi-interview'])
const context = { sessionManager: { getSessionId: () => 'interview-smoke' } } as Parameters<typeof tool.execute>[4]
const params = {
  title: 'Project setup',
  questions: [
    { question: 'Database', kind: 'single', options: ['SQLite', 'PostgreSQL'] },
    { question: 'Platforms', kind: 'multiple', options: ['Web', 'TUI'] },
    { question: 'Notes', kind: 'text', required: false },
  ],
}
try {
  const result = tool.execute('call-one', params, undefined, undefined, context)
  const [payload] = listPendingPiUiPayloads('interview-smoke')
  const prompt = extractPiQuestion(payload)!
  assert.equal(prompt.id, 'pi-interview-call-one')
  assert.equal(prompt.questions?.length, 3)
  assert.ok(isTabbedQuestionnaire(prompt))
  assert.throws(() => respondPiUiQuestion('interview-smoke', prompt.id, { q1: ['invalid'] }), /available options/)
  assert.equal(listPendingPiUiPayloads('interview-smoke').length, 1)
  respondPiUiQuestion('interview-smoke', prompt.id, { q1: ['SQLite'], q2: ['Web', 'TUI'] })
  assert.deepEqual((await result).content, [{ type: 'text', text: '{"q1":["SQLite"],"q2":["Web","TUI"]}' }])
  assert.throws(() => respondPiUiQuestion('interview-smoke', prompt.id, {}))
  const dismissed = tool.execute('call-two', params, undefined, undefined, context)
  respondPiUiPermission('interview-smoke', 'pi-interview-call-two', 'reject')
  assert.match(JSON.stringify((await dismissed).content), /ended without a submission/)
  const controller = new AbortController()
  const interrupted = tool.execute('call-three', params, controller.signal, undefined, context)
  controller.abort()
  assert.match(JSON.stringify((await interrupted).content), /ended without a submission/)
  assert.equal(active.size, 0)
  assert.equal(frames.filter(frame => frame.includes('question.completed')).length, 3)
} finally {
  remove()
  applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
}

const session = {} as AgentSession
const bus = createEventBus()
observePiMcpStatus(bus)(session)
assert.equal(readPiMcpStatus(session), undefined)
bus.emit('pi-mcp-adapter/status/v1', { version: 1, servers: [{ name: 'docs', status: 'cached', toolCount: 4 }, { name: 'ignore', status: 'unexpected' }] })
assert.deepEqual(readPiMcpStatus(session), ['docs · cached · 4 tools'])
assert.equal(readPiMcpStatus({} as AgentSession), undefined)

const finish = beginSessionCompaction('opencode', 'compact-smoke')
assert.throws(() => beginSessionCompaction('opencode', 'compact-smoke'), /busy/)
assert.equal(readSessionCompaction('pi', 'compact-smoke').busy, false)
const translator = new OpenCode2EventTranslator()
const [frame] = translator.translate({ type: 'session.next.compaction.ended', data: { sessionID: 'compact-smoke', reason: 'manual' } })
assert.equal(frame?.payload.type, 'session.compacted')
finish('completed')
assert.deepEqual(readSessionCompaction('opencode', 'compact-smoke'), { status: 'completed', busy: false })
const fail = beginSessionCompaction('opencode', 'compact-smoke')
finish('completed')
assert.equal(readSessionCompaction('opencode', 'compact-smoke').status, 'pending')
fail('failed')
assert.equal(readSessionCompaction('opencode', 'compact-smoke').status, 'failed')

const rows = piSubagentRows('worker', { results: [{ agent: 'scout', runId: 'run-1', index: 0, sessionId: 'child-1', status: 'running' }] })
assert.equal(rows[0]?.status, 'running')
assert.equal(rows[0]?.childSessionId, 'child-1')
assert.equal(piSubagentRows('worker', { runId: 'deferred', state: 'queued' })[0]?.childSessionId, undefined)

const result = { text: 'raw output', isError: false, truncated: false, structured: { queries: [{ results: [{ title: 'Pi docs', url: 'https://pi.dev/docs', snippet: 'API guide' }, { title: 'Invalid source', url: 'javascript:alert(1)' }] }] } }
const card = await webResults.toolCard!({ target: { sessionId: 'web', provider: 'pi' }, tool: { id: 'search', name: 'web_search', input: {} }, result })
assert.deepEqual(card && card.blocks, [{ type: 'link', label: 'Pi docs', url: 'https://pi.dev/docs' }, { type: 'text', text: 'API guide' }])
assert.equal(await webResults.toolCard!({ target: { sessionId: 'web', provider: 'pi' }, tool: { id: 'bad', name: 'web_search', input: {} }, result: { ...result, isError: true } }), undefined)
console.log('Provider plugin adaptations smoke passed')
