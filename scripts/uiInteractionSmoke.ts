// Interactions are counted in memory and sent in bulk: a click never posts, a burst is one report,
// and what reaches plugins is a count by action and tool, never anything about the content.
import assert from 'node:assert/strict'
import { flushUiInteractions, reportUiInteraction, setUiInteractionSink, UI_INTERACTION_FLUSH_MS, type UiInteractionReport } from '../lib/plugins/uiInteractions'
import { onPluginRuntimeEvent } from '../lib/plugins/runtimeEvents'
import { pluginRuntimeCapabilities } from '../lib/plugins/runtimeEvents'
const { POST } = await import('../app/api/plugins/ui-interaction/route')

const sent: UiInteractionReport[][] = []
const session = { provider: 'claude', sessionId: 's1' }
reportUiInteraction('expand', 'mcp__a__b', session)            // no sink yet: dropped, free
setUiInteractionSink(reports => { sent.push([...reports]) })
for (let i = 0; i < 50; i++) reportUiInteraction(i % 2 ? 'fold' : 'expand', 'mcp__a__b', session)
reportUiInteraction('expand', 'mcp__a__c', { provider: 'claude', providerInstanceId: 'work', sessionId: 's1' })
reportUiInteraction('expand', 'mcp__a__b', { sessionId: 's1' })          // no provider: not reportable
reportUiInteraction('expand', 'bad name with spaces', session)            // not a tool name: refused
assert.equal(sent.length, 0, 'nothing is posted per interaction')
assert.ok(UI_INTERACTION_FLUSH_MS >= 10_000)
flushUiInteractions()
assert.equal(sent.length, 1, 'one batch')
const byKey = Object.fromEntries(sent[0]!.map(r => [`${r.target.providerInstanceId ?? ''}|${r.action}|${r.subject}`, r.count]))
assert.deepEqual(byKey, { '|expand|mcp__a__b': 25, '|fold|mcp__a__b': 25, 'work|expand|mcp__a__c': 1 })
flushUiInteractions(); assert.equal(sent.length, 1, 'an empty flush sends nothing')

// The route publishes validated counts as ui.interaction and drops the rest.
const events: { type: string; interaction?: { action: string; subject: string; count: number }; source: string; target: { sessionId: string } }[] = []
const off = onPluginRuntimeEvent(event => { if (event.type === 'ui.interaction') events.push(event as never) })
const post = (reports: unknown) => POST(new Request('http://x/api/plugins/ui-interaction', { method: 'POST', body: JSON.stringify({ reports }) }))
const ok = await (await post([
  { target: { provider: 'claude', sessionId: 's1' }, action: 'expand', subject: 'mcp__a__b', count: 3 },
  { target: { provider: 'nope', sessionId: 's1' }, action: 'expand', subject: 'mcp__a__b', count: 1 },
  { target: { provider: 'claude', sessionId: 's1' }, action: 'explode', subject: 'mcp__a__b', count: 1 },
  { target: { provider: 'claude', sessionId: 's1' }, action: 'fold', subject: 'has space', count: 1 },
  { target: { provider: 'claude', sessionId: 's1' }, action: 'fold', subject: 'mcp__a__b', count: 0 },
  { target: { provider: 'claude', sessionId: 's1' }, action: 'fold', subject: 'mcp__a__b', count: 1.5 },
])).json()
off()
assert.equal(ok.accepted, 1); assert.equal(events.length, 1)
assert.deepEqual(events[0]!.interaction, { action: 'expand', subject: 'mcp__a__b', count: 3 }); assert.equal(events[0]!.source, 'renderer')
assert.equal((await post('nope')).status, 400); assert.equal((await post(Array.from({ length: 201 }, () => ({})))).status, 400)
assert.equal(pluginRuntimeCapabilities('claude').interactions, 'renderer-reports')
console.log('uiInteractionSmoke: ok')
process.exit(0)
