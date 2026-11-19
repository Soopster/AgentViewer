import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'av-plugin-panel-contributor-'))
function run(command, args) {
  const result = spawnSync(command, args, { cwd: temporary, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`)
}

try {
  // A source-only copy: never mutate the user's registration tables to test a
  // hypothetical contributor. Include current shared-worktree changes.
  const listing = spawnSync('rg', ['--files', '--hidden', '-g', '!node_modules', '-g', '!.git', '-g', '!.next', '-g', '!work', '-g', '!.agent-viewer-data'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(listing.status, 0)
  const sources = listing.stdout.trim().split('\n').filter(name => /\.(?:[cm]?ts|tsx|[cm]?js|json)$/.test(name))
  await Promise.all(sources.map(async name => {
    const destination = path.join(temporary, name)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(root, name), destination)
  }))
  await symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir')
  const nextEnv = await readFile(path.join(temporary, 'next-env.d.ts'), 'utf8')
  await writeFile(path.join(temporary, 'next-env.d.ts'), nextEnv.replace(/^import .*\.next.*\n/gm, ''))
  // Only a manifest, its views, and the two loader entries are added.
  const pluginDir = path.join(temporary, 'plugins/fixture-panel')
  await mkdir(pluginDir, { recursive: true })
  const manifest = (await readFile(path.join(root, 'plugins/files/manifest.ts'), 'utf8')).replaceAll("'files'", "'fixture-panel'")
  await writeFile(path.join(pluginDir, 'manifest.ts'), manifest)
  for (const renderer of ['web', 'tui']) {
    await mkdir(path.join(pluginDir, renderer))
    await writeFile(path.join(pluginDir, renderer, 'index.ts'), "export const module = { apiVersion: 1 as const, pluginId: 'fixture-panel', views: { 'fixture-panel': () => null } }\n")
    const loaderPath = path.join(temporary, renderer === 'web' ? 'components/shell/pluginViews.ts' : 'tui/opentui/shell/pluginViews.ts')
    const specifier = renderer === 'web' ? '@/plugins/fixture-panel/web' : '../../../plugins/fixture-panel/tui'
    const loader = await readFile(loaderPath, 'utf8')
    await writeFile(loaderPath, loader.replace("  analytics: async", `  'fixture-panel': async () => (await import('${specifier}')).module,\n  analytics: async`))
  }
  const catalogPath = path.join(temporary, 'lib/plugins/catalog.ts')
  const catalog = await readFile(catalogPath, 'utf8')
  await writeFile(catalogPath, "import { manifest as fixturePanel } from '../../plugins/fixture-panel/manifest'\n" + catalog.replace('PLUGIN_MANIFESTS = [', 'PLUGIN_MANIFESTS = [fixturePanel, '))
  // A headless executable feature also needs only its package and registration,
  // without a view module, palette callback, renderer branch or root state.
  const actionDir = path.join(temporary, 'plugins/fixture-action')
  await mkdir(actionDir, { recursive: true })
  await writeFile(path.join(actionDir, 'manifest.ts'), `
    import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
    export const manifest = {
      apiVersion: PLUGIN_API_VERSION, id: 'fixture-action', title: 'Fixture action', description: 'A headless action.',
      renderers: ['web', 'tui'], stateVersion: 1, surfaces: [],
      commands: [{ id: 'fixture-action', label: 'Fixture action', category: 'View', handler: 'run', scope: 'application',
        requires: null, renderers: ['web', 'tui'], services: ['notices'] }],
    } as const satisfies PluginManifest
  `)
  await writeFile(path.join(actionDir, 'commands.ts'), `
    import type { PluginCommandModule } from '../../lib/plugins/commands'
    export const commands: PluginCommandModule = {
      apiVersion: 1, pluginId: 'fixture-action', handlers: { run: ({ services }) => services.notices!.show('info', 'Fixture action') },
    }
  `)
  for (const renderer of ['web', 'tui']) {
    const commandPath = path.join(temporary, renderer === 'web' ? 'components/shell/pluginCommands.ts' : 'tui/opentui/shell/pluginCommands.ts')
    const specifier = renderer === 'web' ? '../../plugins/fixture-action/commands' : '../../../plugins/fixture-action/commands'
    const loader = await readFile(commandPath, 'utf8')
    await writeFile(commandPath, loader.replace("  'composer-tools':", `  'fixture-action': async () => (await import('${specifier}')).commands,\n  'composer-tools':`))
  }
  const withPanel = await readFile(catalogPath, 'utf8')
  await writeFile(catalogPath, "import { manifest as fixtureAction } from '../../plugins/fixture-action/manifest'\n" + withPanel.replace('PLUGIN_MANIFESTS = [', 'PLUGIN_MANIFESTS = [fixtureAction, '))
  // Inline customization is a distinct contribution, not a hidden surface.
  const accessoryDir = path.join(temporary, 'plugins/fixture-accessory')
  await mkdir(accessoryDir, { recursive: true })
  await writeFile(path.join(accessoryDir, 'manifest.ts'), `
    import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
    export const manifest = {
      apiVersion: PLUGIN_API_VERSION, id: 'fixture-accessory', title: 'Fixture accessory', description: 'Inline customization.',
      renderers: ['web', 'tui'], stateVersion: 1, surfaces: [], commands: [],
      composer: [{ id: 'fixture-accessory', title: 'Fixture accessory', maxRows: 1, services: [] }],
    } as const satisfies PluginManifest
  `)
  for (const renderer of ['web', 'tui']) {
    await writeFile(path.join(accessoryDir, `${renderer}.ts`), `export const composer = { apiVersion: 1 as const, pluginId: 'fixture-accessory', accessories: { 'fixture-accessory': () => null } }`)
    const composerPath = path.join(temporary, renderer === 'web' ? 'components/shell/composerPlugins.ts' : 'tui/opentui/shell/composerPlugins.ts')
    const specifier = renderer === 'web' ? '../../plugins/fixture-accessory/web' : '../../../plugins/fixture-accessory/tui'
    const loader = await readFile(composerPath, 'utf8')
    await writeFile(composerPath, loader.replace('  goals:', `  'fixture-accessory': async () => (await import('${specifier}')).composer,\n  goals:`))
  }
  const withAction = await readFile(catalogPath, 'utf8')
  await writeFile(catalogPath, "import { manifest as fixtureAccessory } from '../../plugins/fixture-accessory/manifest'\n" + withAction.replace('PLUGIN_MANIFESTS = [', 'PLUGIN_MANIFESTS = [fixtureAccessory, '))
  // A dashboard contributes its own page, tab and launcher without a root case.
  const dashboardDir = path.join(temporary, 'plugins/fixture-dashboard')
  await mkdir(dashboardDir, { recursive: true })
  await writeFile(path.join(dashboardDir, 'manifest.ts'), `
    import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
    export const manifest = {
      apiVersion: PLUGIN_API_VERSION, id: 'fixture-dashboard', title: 'Fixture dashboard', description: 'An app page.',
      renderers: ['web'], stateVersion: 1,
      surfaces: [{ id: 'fixture-dashboard', title: 'Fixture dashboard', pin: null, single: true, keys: 'window', placements: ['window', 'overlay'], windowLabel: 'Fixture', services: [] }],
      dashboards: [{ id: 'fixture-dashboard', title: 'Fixture', glyph: 'F', command: 'fixture-dashboard', surface: 'fixture-dashboard' }],
      commands: [{ id: 'fixture-dashboard', label: 'Fixture dashboard', category: 'View', opens: 'fixture-dashboard', scope: 'application', requires: null, renderers: ['web'], webDashboard: 'fixture-dashboard' }],
    } as const satisfies PluginManifest
  `)
  await writeFile(path.join(dashboardDir, 'web.ts'), "export const module = { apiVersion: 1 as const, pluginId: 'fixture-dashboard', views: { 'fixture-dashboard': () => null } }")
  const dashboardLoaderPath = path.join(temporary, 'components/shell/pluginViews.ts')
  const dashboardLoader = await readFile(dashboardLoaderPath, 'utf8')
  await writeFile(dashboardLoaderPath, dashboardLoader.replace('  analytics:', "  'fixture-dashboard': async () => (await import('../../plugins/fixture-dashboard/web')).module,\n  analytics:"))
  const withAccessory = await readFile(catalogPath, 'utf8')
  await writeFile(catalogPath, "import { manifest as fixtureDashboard } from '../../plugins/fixture-dashboard/manifest'\n" + withAccessory.replace('PLUGIN_MANIFESTS = [', 'PLUGIN_MANIFESTS = [fixtureDashboard, '))
  // A session reader rail uses the existing host: only its package, catalog and
  // lazy view registration change. Its optional slot keeps window/overlay use valid.
  const readerDir = path.join(temporary, 'plugins/fixture-reader')
  await mkdir(readerDir, { recursive: true })
  await writeFile(path.join(readerDir, 'manifest.ts'), `
    import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'
    export const manifest = {
      apiVersion: PLUGIN_API_VERSION, id: 'fixture-reader', title: 'Fixture reader', description: 'Session reader customization.',
      renderers: ['web'], stateVersion: 1,
      reader: [{ id: 'fixture-reader', surface: 'fixture-reader', width: 280, order: 20 }],
      surfaces: [{ id: 'fixture-reader', title: 'Fixture reader', pin: 'session', single: false, keys: 'window',
        placements: ['panel', 'window', 'overlay'], windowLabel: 'Fixture reader in a window', services: [], optionalServices: ['reader-slot'] }],
      commands: [{ id: 'fixture-reader', label: 'Toggle fixture reader', category: 'Transcript', opens: 'fixture-reader',
        requires: 'session', scope: 'session', renderers: ['web'], webReader: 'fixture-reader',
        webReaderAction: 'toggle', webViewMenuLabel: 'Fixture reader' }],
    } as const satisfies PluginManifest
  `)
  await writeFile(path.join(readerDir, 'web.ts'), `
    import { useEffect } from 'react'
    import type { WebPluginView } from '../../components/shell/pluginTypes'
    import type { PluginViewModule } from '../../lib/plugins/types'
    const Reader: WebPluginView = ({ services, useState: usePluginState }) => {
      const slot = services['reader-slot']
      const [visible, setVisible] = usePluginState('visible', false)
      const [handled, setHandled] = usePluginState('handled-request', 0)
      useEffect(() => {
        if (!slot || slot.request.serial <= handled) return
        setHandled(slot.request.serial)
        setVisible(slot.request.action === 'toggle' ? !visible : true)
      }, [slot, handled, visible, setHandled, setVisible])
      useEffect(() => { slot?.report({ visible, count: 3 }) }, [slot, visible])
      return null
    }
    export const module: PluginViewModule<WebPluginView> = {
      apiVersion: 1, pluginId: 'fixture-reader', views: { 'fixture-reader': Reader },
    }
  `)
  const readerLoader = await readFile(dashboardLoaderPath, 'utf8')
  await writeFile(dashboardLoaderPath, readerLoader.replace('  analytics:', "  'fixture-reader': async () => (await import('../../plugins/fixture-reader/web')).module,\n  analytics:"))
  const withDashboard = await readFile(catalogPath, 'utf8')
  await writeFile(catalogPath, "import { manifest as fixtureReader } from '../../plugins/fixture-reader/manifest'\n" + withDashboard.replace('PLUGIN_MANIFESTS = [', 'PLUGIN_MANIFESTS = [fixtureReader, '))
  await writeFile(path.join(temporary, 'scripts/fixtureReaderRegistrationSmoke.ts'), `
    import assert from 'node:assert/strict'
    import { listReaderPlugins, createReaderPluginController } from '../lib/plugins/reader'
    import { getPluginCommand } from '../lib/plugins/catalog'
    import { webPluginViews } from '../components/shell/pluginViews'
    const spec = listReaderPlugins().find(spec => spec.id === 'fixture-reader')!
    assert.ok(spec, 'catalog registration discovers reader metadata')
    assert.equal(spec.width, 280)
    assert.equal(spec.surface, 'fixture-reader')
    assert.equal(getPluginCommand('fixture-reader')?.webReaderAction, 'toggle')
    assert.equal(webPluginViews.isLoaded('fixture-reader'), false)
    const view = await webPluginViews.load('fixture-reader')
    assert.equal(typeof view.views[spec.surface], 'function')
    const controller = createReaderPluginController([spec])
    assert.equal(controller.open(spec.id, 'toggle'), true)
    assert.deepEqual(controller.request(spec.id), { serial: 1, action: 'toggle' })
    controller.dispose()
    webPluginViews.dispose()
    console.log('contributor reader registration: PASS (metadata, command, lazy view and request)')
  `)
  run('bun', ['run', './scripts/fixtureReaderRegistrationSmoke.ts'])
  run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--incremental', 'false'])
  run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--incremental', 'false', '-p', 'tsconfig.opentui.json'])
  console.log('plugin contributor smoke: PASS (panel, headless action, composer accessory, dashboard and Web reader; packages and registrations only; reader discovery and both application typechecks)')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
