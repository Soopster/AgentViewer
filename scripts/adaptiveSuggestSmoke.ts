// Suggestions come from how the app is used, never apply themselves, and a view suggestion only ever
// adds a new, unselected view.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-suggest-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes')
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
// tui.json lives under the working directory: run from a scratch one so the real file is never touched.
process.chdir(root)
const { suggest, SUGGEST_LIMITS } = await import('../lib/adaptiveUi/suggest')
const shape = (tool: string, count: number) => ({ key: `${tool}|q`, tool, inputKeys: ['q'], count, firstSeen: 1, lastSeen: 2, samples: [] })
const base = { shapes: [], usage: [], interactions: {}, ruledTools: new Set<string>(), dismissed: new Set<string>(), existingViewIds: new Set<string>() }

// Cards: frequent or often-opened shapes, never ones that already have a rule or were dismissed.
assert.deepEqual(suggest({ ...base, shapes: [shape('mcp__a__rare', 2)] }), [])
assert.deepEqual(suggest({ ...base, shapes: [shape('mcp__a__busy', SUGGEST_LIMITS.cardCalls)] }).map(s => s.id), ['card:mcp__a__busy'])
assert.deepEqual(suggest({ ...base, shapes: [shape('mcp__a__opened', 1)], interactions: { mcp__a__opened: { expand: SUGGEST_LIMITS.cardOpens, fold: 0, toggle: 0 } } }).map(s => s.id), ['card:mcp__a__opened'], 'opening a card often is a reason by itself')
assert.deepEqual(suggest({ ...base, shapes: [shape('mcp__a__busy', 9)], ruledTools: new Set(['mcp__a__busy']) }), [])
assert.deepEqual(suggest({ ...base, shapes: [shape('mcp__a__busy', 9)], dismissed: new Set(['card:mcp__a__busy']) }), [])
assert.deepEqual(suggest({ ...base, shapes: [{ ...shape('mcp__a__busy', 9), dismissed: true }] }), [])
assert.deepEqual(suggest({ ...base, shapes: [shape('mcp__a__x', 6), shape('mcp__a__y', 20)] }).map(s => s.id), ['card:mcp__a__y', 'card:mcp__a__x'], 'the busier one first')

// Views: many calls almost never opened suggests grouping; most calls opened suggests opening by default.
const usage = (completed: number) => [{ tool: 'Bash', completed, failed: 0 }]
const grouped = suggest({ ...base, usage: usage(SUGGEST_LIMITS.minCalls), interactions: { Bash: { expand: 1, fold: 0, toggle: 0 } } })
assert.deepEqual(grouped.map(s => s.id), ['view:grouped']); assert.deepEqual((grouped[0] as { view: { overrides: unknown } }).view.overrides, { toolGrouping: 'stream' })
assert.deepEqual(suggest({ ...base, usage: usage(SUGGEST_LIMITS.minCalls - 1) }), [], 'too little data suggests nothing')
assert.deepEqual(suggest({ ...base, usage: usage(40), interactions: { Bash: { expand: 20, fold: 0, toggle: 0 } } }).map(s => s.id), ['view:expanded'])
assert.deepEqual(suggest({ ...base, usage: usage(40), interactions: { Bash: { expand: 10, fold: 0, toggle: 0 } } }), [], 'between the two thresholds nothing is suggested')
assert.deepEqual(suggest({ ...base, usage: usage(40), existingViewIds: new Set(['adaptive-grouped']) }), [], 'a view already added is not suggested again')

// Through the runtime: applying a view suggestion adds an unselected custom view, once.
const { nativeAdaptiveUi, noteToolCompleted, noteInteraction } = await import('../lib/adaptiveUi/runtime')
const { getConfiguredTuiCustomViews } = await import('../lib/tuiState')
for (let i = 0; i < 45; i++) noteToolCompleted('Bash', false)
noteInteraction('Bash', 'expand', 2)
const before = await getConfiguredTuiCustomViews()
const snap = await nativeAdaptiveUi.scan()
assert.ok(snap.suggestions.some(s => s.id === 'view:grouped'))
assert.match(await nativeAdaptiveUi.applySuggestion('view:grouped'), /Adaptive · grouped tools/)
const after = await getConfiguredTuiCustomViews()
assert.equal(after.views.length, before.views.length + 1); assert.equal(after.activeId, before.activeId, 'never selected for the person')
const added = after.views.find(view => view.id === 'adaptive-grouped')!
assert.equal(added.base, 'stream'); assert.equal((added.overrides as { toolGrouping?: string }).toolGrouping, 'stream')
assert.ok(!(await nativeAdaptiveUi.scan()).suggestions.some(s => s.id === 'view:grouped'), 'applied suggestions go away')
await assert.rejects(nativeAdaptiveUi.applySuggestion('view:grouped'), /no longer applies/)
await nativeAdaptiveUi.dismissSuggestion('view:expanded'); await assert.rejects(nativeAdaptiveUi.applySuggestion('view:expanded'), /no longer applies/)
console.log('adaptiveSuggestSmoke: ok')
process.exit(0)
