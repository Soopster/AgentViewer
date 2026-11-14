// Static validation never imports the mod. --render explicitly runs trusted code in bounded children.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseLocalPluginManifest, decodeLocalWidgetContent } from '../lib/plugins/localManifest'
import { PLUGIN_MANIFESTS } from '../lib/plugins/catalog'
import { decodeModView, readModComponentViews } from '../lib/plugins/modViews'
import { EMPTY_MOD_APP, freezeSnapshot } from '../lib/plugins/modApp'
import type { LocalPluginManifest } from '../lib/plugins/localManifest'

const args = process.argv.slice(2)
if (args.includes('--help')) { console.log('Usage: agent-viewer mods check <path> [--render] [--json]'); process.exit(0) }
const dir = path.resolve(args[0] ?? '.')
const problems: string[] = []
const warnings: string[] = []
let manifest: LocalPluginManifest | null = null
let entry: string | undefined
try {
  const parsed = parseLocalPluginManifest(JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8')), new Set(PLUGIN_MANIFESTS.map(item => item.id)))
  manifest = parsed.manifest
  problems.push(...parsed.problems)
  entry = ['server.mjs', 'server.js', 'server.ts'].find(file => existsSync(path.join(dir, file)))
  if (!entry) problems.push('Missing server.mjs, server.js or server.ts')
} catch (error) { problems.push(error instanceof Error ? error.message : String(error)) }
const importModule = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>
const fixture = freezeSnapshot({ ...EMPTY_MOD_APP, instanceId: 'web-check', cwd: '/fixture', selectedKey: 'claude:fixture', sessions: [{ key: 'claude:fixture', title: 'Fixture session', cwd: '/fixture', activity: 'running', target: { provider: 'claude', sessionId: 'fixture' } }] })

async function renderCheck(renderer: 'server' | 'web' | 'tui'): Promise<void> {
  if (!manifest || !entry) throw new Error('Invalid mod')
  if (renderer === 'server') {
    const exported = await importModule(pathToFileURL(path.join(dir, entry)).href)
    const module = (exported.default && typeof exported.default === 'object' ? exported.default : exported) as Record<string, unknown>
    const table = (name: string) => module[name] as Record<string, (context: unknown) => unknown> | undefined
    for (const hook of manifest.behavior?.hooks ?? []) if (typeof module[hook] !== 'function') throw new Error(`Missing ${hook} export`)
    for (const command of manifest.commands.filter(item => item.handler)) if (typeof table('commands')?.[command.handler!] !== 'function') throw new Error(`Missing commands.${command.handler}`)
    if (manifest.localProvider) for (const method of ['listSessions', 'readMessages', 'createSession', 'sendTurn']) if (typeof (module.provider as Record<string, unknown> | undefined)?.[method] !== 'function') throw new Error(`Missing provider.${method}`)
    const context = { signal: new AbortController().signal, ...(manifest.appServices?.length ? { app: fixture } : {}) }
    for (const view of manifest.localViews ?? []) {
      if (view.component) continue
      const fn = table('views')?.[view.id]
      if (typeof fn !== 'function') throw new Error(`Missing views.${view.id}`)
      const raw = await fn(context) as { title?: unknown; blocks?: unknown[] }
      if (!raw || !Array.isArray(raw.blocks) || typeof raw.title !== 'string') throw new Error(`Invalid view ${view.id}: expected title and blocks`)
      if (decodeModView(raw, view.title).blocks.length !== raw.blocks.length) throw new Error(`Invalid blocks in ${view.id}`)
    }
    for (const widget of manifest.localWidgets ?? []) {
      const fn = table('widgets')?.[widget.id]
      if (typeof fn !== 'function') throw new Error(`Missing widgets.${widget.id}`)
      const raw = await fn(context)
      if (raw != null && !decodeLocalWidgetContent(manifest.id, widget.id, manifest.title, raw)) throw new Error(`Invalid widget ${widget.id}`)
    }
    return
  }
  const file = [`${renderer}.mjs`, `${renderer}.js`].find(name => existsSync(path.join(dir, name)))
  if (!file) return
  const React = await import('react')
  const module = readModComponentViews(await importModule(pathToFileURL(path.join(dir, file)).href), React)
  for (const view of manifest.localViews?.filter(item => item.component) ?? []) {
    if (typeof module[view.id] !== 'function') throw new Error(`Missing ${renderer} component ${view.id}`)
    const unavailable = async () => { throw new Error('App actions are unavailable during render checks') }
    const app = { getSnapshot: () => fixture, subscribe: () => () => {}, commands: { list: () => [], run: unavailable }, openSession: unavailable, openFile: unavailable }
    const props = { React, view: { pluginId: manifest.id, viewId: view.id, title: view.title }, run: unavailable, close() {}, app: manifest.appServices?.length ? app : undefined }
    if (renderer === 'web') {
      const { renderToString } = await import('react-dom/server')
      renderToString(React.createElement(module[view.id] as React.ComponentType<Record<string, unknown>>, props))
    } else {
      const { testRender, act } = await import('../tui/opentui/testRender')
      const { getThemePalette } = await import('../tui/theme')
      const setup = await testRender(React.createElement(module[view.id] as React.ComponentType<Record<string, unknown>>, { ...props, theme: getThemePalette('dark'), width: 80, height: 24, registerKeys() {} }), { width: 80, height: 24 })
      try { await act(async () => { await setup.flush() }); setup.captureCharFrame() } finally { setup.renderer.destroy() }
    }
  }
}
if (args.includes('--render-child')) {
  try { await renderCheck(args[args.indexOf('--render-child') + 1] as 'server' | 'web' | 'tui'); process.exit(0) }
  catch (error) { console.error(error instanceof Error ? error.stack : error); process.exit(1) }
}
if (!args[0] || args[0].startsWith('--') || args.slice(1).some(arg => !['--render', '--json'].includes(arg))) { console.error('Usage: agent-viewer mods check <path> [--render] [--json]'); process.exit(2) }
// Walk only the mod's source tree; never follow symlinks or inspect dependencies.
async function checkSources(folder: string): Promise<void> {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue
    const file = path.join(folder, item.name)
    if (item.isDirectory()) await checkSources(file)
    else if (item.isFile() && /\.(mjs|js|ts)$/.test(item.name)) {
      try {
        const runtime = globalThis as unknown as { Bun: { Transpiler: new (options: { loader: string }) => { scan(source: string): unknown } } }
        new runtime.Bun.Transpiler({ loader: item.name.endsWith('.ts') ? 'ts' : 'js' }).scan(readFileSync(file, 'utf8'))
      }
      catch (error) { problems.push(`${path.relative(dir, file)}: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
}
if (existsSync(dir)) { try { await checkSources(dir) } catch (error) { problems.push(error instanceof Error ? error.message : String(error)) } }
if (entry?.endsWith('.ts')) warnings.push('server.ts requires Bun in the app runtime; syntax validation does not prove Node compatibility.')
const componentViews = manifest?.localViews?.filter(item => item.component) ?? []
const renderers = (['web', 'tui'] as const).filter(renderer => [`${renderer}.mjs`, `${renderer}.js`].some(name => existsSync(path.join(dir, name))))
if (componentViews.length && !renderers.length) problems.push('Component views require web.mjs and/or tui.mjs')
if (componentViews.length && renderers.length === 1) warnings.push(`Component views are unavailable in ${renderers[0] === 'web' ? 'OpenTUI' : 'Web'}.`)
const checks = ['manifest', 'entry files', 'source syntax']
if (args.includes('--render') && !problems.length) {
  warnings.push('Render checks execute trusted mod code, including import side effects. They are not a sandbox and do not prove later async behavior.')
  for (const renderer of ['server', ...renderers] as const) {
    if (renderer !== 'server' && !componentViews.length) continue
    const executable = process.execPath
    const execArgs = ['run']
    const result = spawnSync(executable, [...execArgs, fileURLToPath(import.meta.url), dir, '--render-child', renderer], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1_000_000 })
    if (result.status !== 0 || result.error) problems.push(`${renderer} render: ${result.error?.message ?? result.stderr.trim() ?? 'failed'}`)
    else checks.push(`${renderer} initial render / exports`)
  }
} else if (!args.includes('--render')) warnings.push('Exports and rendering were not executed. Use --render for trusted code.')
const report = { version: 1, path: dir, pluginId: manifest?.id ?? null, ok: !problems.length, checks, warnings, problems }
if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
else { console.log(`${report.ok ? 'PASS' : 'FAIL'} ${report.pluginId ?? dir}`); for (const message of problems) console.log(`  error: ${message}`); for (const warning of warnings) console.log(`  note: ${warning}`) }
process.exit(report.ok ? 0 : 1)
