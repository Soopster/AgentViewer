import assert from 'node:assert/strict'
import { THEMES, THEME_GROUPS, THEME_META, isKnownTheme, registerTheme } from '../lib/themes'
import { THEMES as TUI_THEMES, THEME_GROUPS as TUI_GROUPS, THEME_LABELS, registerTuiPluginTheme, isLightThemeMode } from '../tui/opentui/app/themes'
import { getThemePalette } from '../tui/theme'
import { getPluginViews, isPluginViewId, normalizePluginViews, setPluginViews, subscribePluginViews } from '../tui/viewSpec'
import { PLUGIN_CATEGORIES, groupPluginEntries, pluginCategory } from '../lib/plugins/managerCategories'
import { PLUGIN_MANIFESTS } from '../lib/plugins/catalog'
import { PROVIDER_PLUGINS } from '../lib/plugins/providerPlugins'
import { localManifestNeedsServer, parseLocalPluginManifest } from '../lib/plugins/localManifest'

const before = THEMES.length
const unregister = registerTheme({ id: 'smoke-theme', label: 'Smoke', category: 'light', icon: '◆', css: '--bg: #fff;' })
assert.ok(isKnownTheme('smoke-theme') && THEMES.length === before + 1)
assert.ok(THEME_GROUPS.find(group => group.category === 'light')!.themes.includes('smoke-theme'))
assert.throws(() => registerTheme({ id: 'dark', label: 'x', category: 'dark', icon: '', css: '--a: 1;' }), /built in/)
assert.throws(() => registerTheme({ id: 'evil', label: 'x', category: 'dark', icon: '', css: '} body { display:none' }), /bare declarations/)
unregister()
assert.ok(!isKnownTheme('smoke-theme') && !(('smoke-theme') in THEME_META) && THEMES.length === before)

const parse = (themes: unknown) => parseLocalPluginManifest({ id: 'pack', themes }, new Set())
const ok = parse([{ id: 'dusk', label: 'Dusk', category: 'dark', css: '--bg: #111;' }])
assert.equal(ok.manifest?.themes?.[0]?.id, 'pack-dusk')
for (const css of ['--a: url(x);', '} * {', '@import "x";', '--a: 1\\']) {
  assert.ok(parse([{ id: 'bad', category: 'dark', css }]).problems.length, `refused: ${css}`)
}
assert.ok(parse([{ id: 'bad', category: 'blue', css: '--a: 1;' }]).problems.length)

const swatch = { bg: '#101820', text: '#e8eef4', muted: '#8a9aa8', accent: '#3aa0ff', warm: '#ffb347' }
const tuiBefore = TUI_THEMES.length
const dropTui = registerTuiPluginTheme({ id: 'smoke-tui', label: 'Smoke Tui', category: 'dark', swatch })
assert.equal(getThemePalette('smoke-tui').bg, swatch.bg)
assert.ok(TUI_THEMES.includes('smoke-tui') && TUI_GROUPS.find(group => group.key === 'dark')!.themes.includes('smoke-tui'))
assert.equal(THEME_LABELS['smoke-tui'], 'SMOKE TUI')
assert.ok(!isLightThemeMode('smoke-tui'))
assert.throws(() => registerTuiPluginTheme({ id: 'dark', label: 'x', category: 'dark', swatch }), /built in/)
assert.throws(() => registerTuiPluginTheme({ id: 'bad-color', label: 'x', category: 'dark', swatch: { ...swatch, bg: 'red' } }), /#rrggbb/)
dropTui()
assert.equal(TUI_THEMES.length, tuiBefore)
assert.notEqual(getThemePalette('smoke-tui').bg, swatch.bg)
const both = parse([{ id: 'duo', category: 'light', css: '--bg: #fff;', tui: swatch }])
assert.ok(both.manifest?.themes?.[0]?.css && both.manifest.themes[0].tui?.swatch)
assert.ok(parse([{ id: 'none', category: 'dark' }]).problems.length)
assert.ok(parse([{ id: 'badtui', category: 'dark', tui: { ...swatch, bg: 'nope' } }]).problems.length)

// Plugin transcript views: validated like stored ones, namespaced, read-only, withdrawn with their plugin.
const views = normalizePluginViews('pack', [
  { id: 'calm', name: 'Calm', base: 'stream', overrides: { density: 'bogus', notAField: 1 } },
  { id: 'bad-base', name: 'Nope', base: 'engineering', overrides: {} },
  { id: 'no_good', name: 'Underscore', base: 'stream', overrides: {} },
])
assert.deepEqual(views.map(view => view.id), ['pack.calm'])
assert.ok(isPluginViewId('pack.calm') && !isPluginViewId('calm'))
let notified = 0
const stop = subscribePluginViews(() => { notified++ })
setPluginViews('pack', views)
assert.equal(getPluginViews().length, 1)
setPluginViews('pack', [])
assert.equal(getPluginViews().length, 0)
assert.equal(notified, 2)
setPluginViews('pack', [])
assert.equal(notified, 2, 'withdrawing nothing notifies nobody')
stop()
const withViews = parseLocalPluginManifest({ id: 'pack', transcriptViews: [{ id: 'calm', name: 'Calm', base: 'stream', overrides: {} }] }, new Set())
assert.equal(withViews.manifest?.transcriptViews?.[0]?.id, 'calm')
assert.ok(parseLocalPluginManifest({ id: 'pack', transcriptViews: [{ id: 'Bad Id', base: 'stream' }] }, new Set()).problems.length)

// Plugin manager headings: every bundled plugin is placed deliberately, providers lead, theme packs and mods are recognised.
const everyEntry = [...PLUGIN_MANIFESTS as readonly any[], ...PROVIDER_PLUGINS]
assert.deepEqual(everyEntry.filter(entry => pluginCategory(entry) === 'Other').map(entry => entry.id), [], 'a bundled plugin has no heading')
const grouped = groupPluginEntries(everyEntry)
assert.equal(grouped[0].category, 'Providers')
assert.equal(grouped.reduce((count, group) => count + group.entries.length, 0), everyEntry.length)
assert.deepEqual(grouped.map(group => group.category), PLUGIN_CATEGORIES.filter(category => grouped.some(group => group.category === category)))
const packOnly = parseLocalPluginManifest({ id: 'just-themes', themes: [{ id: 'a', category: 'dark', css: '--bg: #000;' }] }, new Set()).manifest!
assert.equal(pluginCategory(packOnly), 'Themes')
assert.equal(pluginCategory({ ...PLUGIN_MANIFESTS[0], group: 'Themes' } as any), 'Themes')
console.log('theme registry smoke passed')

// The built-ins now live in plugins: a bundled pack registers them, and disabling it removes them.
import { installPluginThemes, bundledWebThemes } from '../lib/plugins/themeContributions'
import { syncTuiPluginThemes } from '../tui/opentui/shell/pluginThemes'
import { applyPluginSettings } from '../lib/plugins/enablement'
assert.equal(THEMES.filter(id => id !== 'dark' && id !== 'light').length, 0, 'nothing but the core themes before plugins register')
installPluginThemes()
syncTuiPluginThemes()
assert.ok(isKnownTheme('nord') && isKnownTheme('metalterm') && isKnownTheme('stripe') && isKnownTheme('imessage'))
assert.equal(THEMES.length, 113)
assert.ok(bundledWebThemes().find(theme => theme.id === 'imessage')?.rules?.includes('.msg'), 'bundled themes keep their extra rules')
assert.throws(() => registerTheme({ id: 'rules-theme', label: 'x', category: 'dark', icon: '', css: '--a: 1;', rules: 'body { x: y }' }), /only a bundled plugin/)
assert.equal(getThemePalette('nord').bg, getThemePalette('nord').bg)
assert.notEqual(getThemePalette('nord'), getThemePalette('light'))
assert.ok(TUI_THEMES.includes('robbyrussell') && TUI_GROUPS.find(group => group.key === 'omz')!.themes.length > 50)
applyPluginSettings({ version: 1, disabled: ['themes-brand'] })
assert.ok(!isKnownTheme('stripe') && isKnownTheme('nord'), 'disabling a pack removes only its themes')
applyPluginSettings({ version: 1, disabled: [] })
assert.ok(isKnownTheme('stripe'))
console.log('built-in theme packs ok')

// Menu order is by label, whatever order plugins registered in.
{
  const sortedBy = (ids: readonly string[], label: (id: string) => string) => ids.every((id, i) => i === 0 || label(ids[i - 1]).localeCompare(label(id)) <= 0)
  for (const group of THEME_GROUPS) assert.ok(sortedBy(group.themes, id => THEME_META[id].label), `web ${group.label} menu is alphabetical`)
  for (const group of TUI_GROUPS) assert.ok(sortedBy(group.themes, id => THEME_LABELS[id]), `terminal ${group.label} menu is alphabetical`)
  const web = THEME_GROUPS.map(group => [...group.themes]), tui = TUI_GROUPS.map(group => [...group.themes])
  const late = registerTheme({ id: 'aaa-late', label: 'AAA', category: 'dark', icon: '', css: '--bg: #000;' })
  assert.equal(THEME_GROUPS[1].themes[0], 'aaa-late', 'a theme registered last still sorts first')
  late()
  const lateTui = registerTuiPluginTheme({ id: 'aaa-late', label: 'AAA', category: 'dark', swatch })
  assert.equal(TUI_GROUPS[1].themes[0], 'aaa-late')
  lateTui()
  assert.deepEqual(THEME_GROUPS.map(group => group.themes), web)
  assert.deepEqual(TUI_GROUPS.map(group => group.themes), tui)
  assert.deepEqual(THEMES, THEME_GROUPS.flatMap(group => group.themes), 'THEMES follows the menu')
}
console.log('theme menu order ok')

// A data-only mod (themes, transcript views) needs no server module; code-bearing mods still do.
assert.equal(localManifestNeedsServer(packOnly), false)
assert.equal(localManifestNeedsServer(withViews.manifest!), false)
assert.equal(localManifestNeedsServer(parseLocalPluginManifest({ id: 'cmd', commands: [{ id: 'go' }] }, new Set()).manifest!), true)
console.log('data-only mods ok')
