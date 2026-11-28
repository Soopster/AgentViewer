import assert from 'node:assert/strict'
import { parseLocalPluginManifest, type LocalWidgetContent } from '../lib/plugins/localManifest'
import { applyWebLocalPlugins } from '../components/shell/localPlugins'
import { registerLocalPluginManifests, listLocalPluginManifests, isPluginPanelSurfaceId, getPluginCommand } from '../lib/plugins/catalog'
import { selectLocalPluginWidgets } from '../lib/plugins/useLocalPluginWidgets'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../lib/plugins/enablement'
const raw = {
  id: 'contributor', version: '1.2.3', hostApi: { min: 1, max: 1 },
  views: [{ id: 'board', title: 'Board', placements: ['panel', 'window'], defaultPlacement: 'panel', panelOrder: 20 }],
  widgets: [{ id: 'center', slot: 'top-center', order: 3 }, { id: 'early', slot: 'top-center', order: 1 }, { id: 'corner' }, { id: 'notice', slot: 'viewport' }],
}
try {
  const parsed = parseLocalPluginManifest(raw, new Set())
  assert.deepEqual(parsed.problems, [])
  const manifest = parsed.manifest!
  assert.deepEqual(manifest.surfaces[0]!.placements, ['panel', 'window'])
  assert.equal(manifest.surfaces[0]!.panelOrder, 20)
  assert.equal(manifest.commands.find(command => command.id === 'contributor:view-board')?.placement, 'panel')
  registerLocalPluginManifests([manifest])
  assert(isPluginPanelSurfaceId('contributor.board'))
  assert.equal(getPluginCommand('contributor:view-board')?.placement, 'panel')
  const wire = JSON.stringify(manifest)
  applyWebLocalPlugins({ local: { plugins: [JSON.parse(wire)] } })
  const roundtrip = listLocalPluginManifests().find(manifest => manifest.id === 'contributor')!
  assert.deepEqual(roundtrip.localViews, manifest.localViews)
  assert.deepEqual(roundtrip.localWidgets, manifest.localWidgets)
  assert.deepEqual(roundtrip.hostApi, { min: 1, max: 1 })
  assert.equal(roundtrip.version, '1.2.3')
  const content: LocalWidgetContent[] = ['center', 'early', 'corner', 'notice', 'orphan'].map(id => ({ pluginId: 'contributor', id, title: id, lines: [id], tone: 'info' }))
  assert.deepEqual(selectLocalPluginWidgets(content, 'top-center').map(widget => widget.id), ['early', 'center'])
  assert.deepEqual(selectLocalPluginWidgets(content, 'viewport').map(widget => widget.id), ['notice'])
  assert.deepEqual(selectLocalPluginWidgets(content, 'corner').map(widget => widget.id), ['corner'])
  applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'contributor', false))
  assert.deepEqual(selectLocalPluginWidgets(content), [])
  for (const bad of [
    { ...raw, widgets: [{ id: 'bad', slot: 'top-bar' }] },
    { ...raw, widgets: [{ id: 'bad', slot: 'corner', order: NaN }] },
    { ...raw, views: [{ id: 'bad', placements: ['panel'], defaultPlacement: 'overlay' }] },
    { ...raw, views: [{ id: 'bad', placements: ['window'] }] },
    { ...raw, views: [{ id: 'bad', placements: ['panel', 'panel'] }] },
  ]) assert.equal(parseLocalPluginManifest(bad, new Set()).manifest, null)
  const legacy = parseLocalPluginManifest({ id: 'legacy', views: [{ id: 'board' }], widgets: [{ id: 'status' }] }, new Set()).manifest!
  assert.deepEqual(legacy.surfaces[0]!.placements, ['overlay', 'window'])
  assert.equal(legacy.localWidgets![0]!.slot, 'corner')
  console.log('Mod contributions: PASS (panel placement, command/catalog registration, package metadata and Web round trip, slot ownership/order, disablement, invalid declaration refusal, legacy defaults)')
} finally { applyPluginSettings(DEFAULT_PLUGIN_SETTINGS); registerLocalPluginManifests([]) }
