import assert from 'node:assert/strict'
import { createPluginBehaviorHost } from '../lib/plugins/behaviorHost'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import { onPluginRuntimeEvent, pluginRuntimeCapabilities, publishPluginRuntimeEvent, type PluginRuntimeEvent } from '../lib/plugins/runtimeEvents'
import { normalizePluginStreamEvent, observePluginRuntimeResponse } from '../lib/plugins/runtimeEventStream'
import { setRunningSession, clearRunningSession } from '../lib/sessionRuntime'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
const saved = readPluginSettings(), target = { provider: 'claude' as const, providerInstanceId: 'fixture-account', sessionId: 'runtime-event-fixture' }
const received: PluginRuntimeEvent[] = [], hookEvents: PluginRuntimeEvent[] = []
const unsubscribe = onPluginRuntimeEvent(event => received.push(event))
const manifest: PluginManifest = { apiVersion: PLUGIN_API_VERSION, id: 'runtime-event-fixture', title: 'Runtime', description: '', renderers: ['web', 'tui'], surfaces: [], commands: [], stateVersion: 1, behavior: { hooks: ['runtimeEvent'] } }
const host = createPluginBehaviorHost([manifest], { [manifest.id]: async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: manifest.id, runtimeEvent: async ({ event }) => { hookEvents.push(event) } }) })
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 10)) }
try {
  setRunningSession(target.sessionId, { ...target, requestId: 'one', interrupt: async () => {} })
  setRunningSession(target.sessionId, { ...target, requestId: 'one', interrupt: async () => {} })
  assert.equal(clearRunningSession(target.sessionId, 'old'), false)
  assert.equal(clearRunningSession(target.sessionId, 'one'), true)
  assert.deepEqual(received.map(event => event.type), ['turn.started', 'turn.settled'])
  assert.equal(received[0]!.target.providerInstanceId, 'fixture-account')
  assert(Object.isFrozen(received[0]!.target)); await settle(); assert.equal(hookEvents.length, 2)
  const fixtures = [
    { provider: 'claude', data: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c', name: 'Read', input: { secret: 'private' } }] } } },
    { provider: 'codex', data: { type: 'codex_item_started', item: { type: 'commandExecution', id: 'x', command: 'private' } } },
    { provider: 'copilot', data: { type: 'copilot_event', event: { type: 'tool.execution_start', data: { toolCallId: 'p', toolName: 'Read' } } } },
    { provider: 'pi', data: { type: 'pi_event', event: { type: 'tool_execution_start', toolCallId: 'i', toolName: 'read' } } },
    { provider: 'opencode', data: { type: 'opencode_event', event: { type: 'message.part.updated', properties: { part: { type: 'tool', callID: 'o', tool: 'read', state: { status: 'running', input: { secret: 'private' } } } } } } },
  ] as const
  for (const fixture of fixtures) {
    const event = normalizePluginStreamEvent({ ...target, provider: fixture.provider }, 'message', fixture.data)
    assert.equal(event[0]?.type, 'tool.started'); assert(!JSON.stringify(event).includes('private'))
  }
  assert.equal(pluginRuntimeCapabilities('mod').tools, 'unsupported')
  assert.equal(pluginRuntimeCapabilities('pi').permission, 'unsupported')
  assert.equal(pluginRuntimeCapabilities('codex').toolInterception, false)
  const frame = `data: ${JSON.stringify(fixtures[0]!.data)}\r\n\r\n`
  const usage = 'event: context-usage\ndata: {"totalTokens":42}\n\n'
  const full = frame + frame + usage
  const chunks = [full.slice(0, frame.length - 3), full.slice(frame.length - 3, frame.length - 2), full.slice(frame.length - 2)]
  const original = new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
  const before = received.length
  assert.equal(await observePluginRuntimeResponse(original, target).text(), full)
  assert.deepEqual(received.slice(before).map(event => event.type), ['tool.started', 'usage.updated'])
  await settle()
  const count = hookEvents.length
  applyPluginSettings(withPluginEnabled(saved, manifest.id, false))
  publishPluginRuntimeEvent({ target, type: 'turn.started', source: 'runtime-registry' }); await settle()
  assert.equal(hookEvents.length, count)
  console.log('Plugin runtime events: PASS (registry lifecycle, immutable qualified identity, bounded async hook dispatch, disablement, five provider envelopes, redaction, fragmented CRLF parsing, deduplication and byte preservation)')
} finally { host.dispose(); unsubscribe(); applyPluginSettings(saved); clearRunningSession(target.sessionId) }
