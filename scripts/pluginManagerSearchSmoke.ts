import assert from 'node:assert/strict'
import { filterPluginManagerEntries, matchesPluginSearch } from '../lib/plugins/managerSearch'
import { PLUGIN_MANIFESTS } from '../lib/plugins/catalog'
import { PROVIDER_PLUGINS } from '../lib/plugins/providerPlugins'
import { PLUGIN_API_VERSION } from '../lib/plugins/types'
import type { LocalPluginManifest } from '../lib/plugins/localManifest'

const local: LocalPluginManifest = { apiVersion: PLUGIN_API_VERSION, id: 'local-checks', title: 'My checks', description: 'Runs project verification', source: 'local', stateVersion: 1, renderers: ['web', 'tui'], surfaces: [], commands: [{ id: 'verify-local', label: 'Run local checks', category: 'View', handler: 'verify', scope: 'application', requires: null, services: [], renderers: ['web', 'tui'], keywords: ['validation'] }] }
const entries = [...PLUGIN_MANIFESTS, ...PROVIDER_PLUGINS, local]
assert.equal(filterPluginManagerEntries(entries, '  ').length, entries.length)
assert.deepEqual(filterPluginManagerEntries(entries, 'DYNAMIC ISLAND').map(entry => entry.id), ['dynamic-island', 'toasts'])
const titles = filterPluginManagerEntries(entries, '').map(entry => entry.title)
assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), 'features, providers and mods share alphabetical order')
assert(filterPluginManagerEntries(entries, 'toggle activity').some(entry => entry.id === 'dynamic-island'), 'command labels are searchable')
assert.deepEqual(filterPluginManagerEntries(entries, 'provider codex').map(entry => entry.id), ['provider:codex', 'provider:codex-acp'])
assert.deepEqual(filterPluginManagerEntries(entries, 'local validation').map(entry => entry.id), ['local-checks'])
assert(matchesPluginSearch('not loaded syntax', ['broken-mod', 'local mod not loaded', 'Syntax error']))
assert.equal(filterPluginManagerEntries(entries, 'never-a-plugin').length, 0)
const disabled = new Set(['dynamic-island', 'provider:codex', 'local-checks'])
assert.deepEqual(filterPluginManagerEntries(entries, 'island', 'disabled', disabled).map(entry => entry.id), ['dynamic-island'])
assert(filterPluginManagerEntries(entries, 'island', 'enabled', disabled).every(entry => !disabled.has(entry.id)))
assert.equal(filterPluginManagerEntries(entries, '', 'enabled', disabled).length, entries.length - disabled.size)
assert.equal(filterPluginManagerEntries(entries, '', 'disabled', disabled).length, disabled.size)
assert.equal(filterPluginManagerEntries(entries, '', 'all', disabled).length, entries.length)
assert.equal(entries.length, PLUGIN_MANIFESTS.length + PROVIDER_PLUGINS.length + 1, 'filtering leaves the catalog intact')
console.log('Plugin manager search: PASS (case-insensitive terms, names, descriptions, commands, providers, local mods, refused diagnostics and immutable catalogs)')
