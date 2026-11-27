// The web's view styling cannot drift from the view registry: every field it
// publishes is a real field the Studio labels as drawn on the web, every CSS
// rule names a published field and one of its values, and the strip rules the
// TUI and web share hide what they say they hide.
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
console.log('web view style smoke passed')
