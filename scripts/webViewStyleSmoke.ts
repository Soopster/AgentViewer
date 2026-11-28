// The web's view styling cannot drift from the view registry: every field it
// publishes is a real field the Studio labels as drawn on the web, every CSS
// rule names a published field and one of its values, and the strip rules the
// TUI and web share hide what they say they hide.
import { computeSessionStripStats, stripLimitEntries, stripPrEntry, stripStatEntries } from '../lib/sessionStripStats'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { orderStripGroups, shapeStripSegments, stripContextBar, stripFolderLabel, stripSeparatorText } from '../lib/composerStrip'
import { WEB_STYLE_FIELDS, webViewStyleOf } from '../components/message-view/webViewStyle'
import { BUILTIN_VIEW_SPECS, VIEW_SPEC_FIELDS, WEB_VIEW_FIELDS } from '../tui/viewSpec'

const fields = new Map(VIEW_SPEC_FIELDS.map((field) => [field.key as string, field]))
for (const key of WEB_STYLE_FIELDS) {
  assert.ok(fields.has(key), `${key} is not a view field`)
  assert.ok(WEB_VIEW_FIELDS.has(key), `${key} is drawn on the web but the Studio labels it terminal-only`)
}

const published = new Set<string>(WEB_STYLE_FIELDS)
const css = readFileSync(new URL('../app/view-style.css', import.meta.url), 'utf8')
let rules = 0
for (const [, name, value] of css.matchAll(/\[data-view-([a-z-]+)(?:='([^']*)')?\]/g)) {
  const key = name!.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  assert.ok(published.has(key), `view-style.css styles data-view-${name}, which is never set`)
  if (value !== undefined) assert.ok(fields.get(key)!.options.some((option) => String(option.value) === value), `${key} has no value '${value}'`)
  rules += 1
}
assert.ok(rules > 50, 'the selector scan found the stylesheet')

const base = BUILTIN_VIEW_SPECS.stream
assert.deepEqual(webViewStyleOf(base, base), {}, 'a view as it ships changes nothing on the web')
assert.deepEqual(webViewStyleOf({ ...base, stripCost: false }, base), { stripCost: false })

const segments = [
  { text: '▶▶ auto', fg: 'warn' }, { text: 'model:opus', fg: 'a', part: 'model' as const }, { text: 'ctx:70% 140k', fg: 'b', part: 'context' as const, urgent: true, percent: 70 },
  { text: 'cost:~$1', fg: 'c', part: 'cost' as const }, { text: 'main', fg: 'd', part: 'branch' as const }, { text: '~1', fg: 'e', part: 'git-count' as const },
]
const palette = { muted: 'dim', accent: 'acc', bright: 'lit' }
const shaped = shapeStripSegments(segments, { ...base, stripModel: false, stripContext: false, stripCost: false, stripGit: 'branch', stripColor: 'muted' }, palette)
assert.deepEqual(shaped.map((segment) => segment.fg), ['warn', 'b', 'dim'], 'modes and urgent meters stay, in their own colour')
assert.equal(shapeStripSegments(segments, base, palette).map((s) => s.text).join(), segments.map((s) => s.text).join(), 'the shipped strip changes nothing')
assert.equal(stripSeparatorText('space'), '  ')

const text = (overrides: Partial<typeof base>) => shapeStripSegments([
  ...segments.slice(0, 4), { text: 'effort:auto', fg: 'f', part: 'effort' as const },
], { ...base, ...overrides }, palette).map((segment) => segment.text)
assert.deepEqual(text({ stripLabels: 'short' }), ['▶▶ auto', 'm:opus', 'c:70% 140k', '$:~$1', 'e:auto'])
assert.deepEqual(text({ stripLabels: 'none' }), ['▶▶ auto', 'opus', '70% 140k', '~$1', 'effort:auto'], 'a bare "auto" keeps its label')
assert.equal(text({ stripContextStyle: 'bar' })[2], 'ctx:▰▰▰▰▱ 70%')
assert.equal(text({ stripContextStyle: 'percent' })[2], 'ctx:70%')
assert.equal(stripContextBar(1), '▰▱▱▱▱ 1%', 'any use shows')
const ordered = orderStripGroups('location', segments.slice(0, 4), segments.slice(4))
assert.deepEqual(ordered.flat().map((segment) => segment.fg), ['warn', 'd', 'e', 'a', 'b', 'c'], 'the warning still leads')
assert.equal(stripFolderLabel('/code/app/web', 'parent', 'web'), 'app/web')
assert.equal(stripFolderLabel('C:\\code\\web', 'parent', 'web'), 'code/web')

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString()
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 800, cache_creation_input_tokens: 100 }
const edit = (id: string, oldText: string, newText: string) => ({ type: 'tool_use', id, name: 'Edit', input: { old_string: oldText, new_string: newText } })
const stats = computeSessionStripStats([
  { type: 'user', timestamp: at(0), message: { content: 'go' } },
  { type: 'assistant', timestamp: at(5), message: { id: 'a', usage, content: [edit('e1', 'a', 'a\nb\nc\n')] } },
  { type: 'assistant', timestamp: at(6), message: { id: 'a', usage, content: [edit('e2', 'x', 'y')] } },
  { type: 'user', timestamp: at(7), message: { content: [{ type: 'tool_result', tool_use_id: 'e2', is_error: true }] } },
  { type: 'user', timestamp: at(500), message: { content: 'again' } },
  { type: 'assistant', timestamp: at(503), message: { id: 'b', content: [] } },
])
assert.deepEqual(stats, { lastTokens: { input: 1000, output: 20 }, cacheHitRatio: 0.8, lines: { added: 3, removed: 1 }, activeMs: 10_000 },
  'repeated usage counts once, a failed edit does not count, idle time is not active time')
assert.deepEqual(computeSessionStripStats([]), { lastTokens: null, cacheHitRatio: null, lines: null, activeMs: null }, 'no data is no reading')
assert.deepEqual(stripStatEntries(stats).map((entry) => entry.text), ['tokens:↑1.0k ↓20', 'cache:80% hit', 'lines:~+3 -1', 'active:10s'])
const limits = stripLimitEntries([{ label: '5h', utilization: 40, resetsAt: null }, { label: '7d', utilization: 80, resetsAt: null }, { label: 'old', utilization: 99, resetsAt: 1 }])
const shownLimits = (stripLimits: 'tightest' | 'all' | 'off') => shapeStripSegments(limits.map((entry) => ({ ...entry, fg: '' })), { ...base, stripLimits }, palette).map((entry) => entry.text)
assert.deepEqual(shownLimits('all'), ['limit:5h 40%', 'limit:7d 80%'], 'a window that has reset is gone')
assert.deepEqual(shownLimits('tightest'), ['limit:7d 80%'])
assert.deepEqual(shownLimits('off'), ['limit:7d 80%'], 'a window near its limit always shows')
const pr = { number: 12, url: '', title: '', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', checkRuns: [], threads: [], reviews: [], headRefName: 'a', baseRefName: 'main' }
assert.equal(stripPrEntry(pr as never).text, 'PR #12 Approved')
assert.deepEqual(shapeStripSegments(stripStatEntries(stats).map((entry) => ({ ...entry, fg: '' })), base, palette), [], 'the new readings are off as shipped')
console.log('web view style smoke passed')
