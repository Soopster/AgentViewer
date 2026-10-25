// Import boundaries for feature plugins, checked on source rather than at
// runtime so a violation fails before anyone loads the code:
//   - a manifest imports only the plugin contract (it is evaluated at boot by
//     both roots and the Web client bundle);
//   - a plugin never imports an app root, another plugin's internals, a
//     provider runtime/SDK, or the session backend;
//   - a TUI view reaches the host only through tui/opentui/shell/sdk.ts, and a
//     Web view only through components/shell/;
//   - the roots never import a plugin's view module directly (only the
//     renderer's lazy loader list may), so a plugin cannot become eager again.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|mjs)$/.test(name) ? [full] : []
})
const importsOf = (file: string): string[] => {
  const source = readFileSync(file, 'utf8')
  // `import x from 'y'`, `export … from 'y'`, a bare `import 'y'`, and `import('y')`.
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1] ?? match[2] ?? match[3]!)
}
const resolve = (from: string, specifier: string): string => specifier.startsWith('@/')
  ? path.join(root, specifier.slice(2))
  : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : specifier
const rel = (file: string) => path.relative(root, file)
const violations: string[] = []
const deny = (file: string, specifier: string, why: string) => violations.push(`${rel(file)} imports ${specifier}: ${why}`)

const pluginsDir = path.join(root, 'plugins')
for (const file of walk(pluginsDir)) {
  const plugin = rel(file).split(path.sep)[1]!
  const isManifest = path.basename(file) === 'manifest.ts'
  const layer = rel(file).split(path.sep)[2]
  for (const specifier of importsOf(file)) {
    const target = resolve(file, specifier)
    const targetRel = path.isAbsolute(target) ? rel(target) : target
    if (isManifest) {
      if (!targetRel.startsWith('lib/plugins/types')) deny(file, specifier, 'a manifest imports only lib/plugins/types')
      continue
    }
    if (/^(app|tui\/opentui\/App|components\/MessageView|components\/CommandPalette|tui\/App)/.test(targetRel)) deny(file, specifier, 'plugins never import an app root')
    if (targetRel.startsWith('plugins/') && targetRel.split('/')[1] !== plugin && !targetRel.endsWith('/manifest')) deny(file, specifier, "another plugin's internals")
    if (/^lib\/(sessionBackend|extensions\/providers\/[^/]+\/(runtime|server))|^@anthropic-ai|^@openai|^@github\/copilot-sdk|^@opencode|^@earendil-works|^@agentclientprotocol/.test(targetRel)) deny(file, specifier, 'plugins use host services, never provider runtimes or SDKs')
    if (layer === 'tui' && targetRel.startsWith('tui/opentui/') && !targetRel.startsWith('tui/opentui/shell/sdk')) deny(file, specifier, 'TUI views reach the host through tui/opentui/shell/sdk')
    if (layer === 'web' && targetRel.startsWith('components/') && !targetRel.startsWith('components/shell/') && !targetRel.startsWith('components/ui/')) deny(file, specifier, 'Web views reach the host through components/shell or components/ui')
    if (layer === 'web' && targetRel.startsWith('tui/')) deny(file, specifier, 'a Web view imports TUI code')
    if (layer === 'tui' && targetRel.startsWith('components/')) deny(file, specifier, 'a TUI view imports Web components')
  }
}

// Roots and everything else outside the plugin and its loader lists must not
// import a plugin's view module: that is what keeps every plugin lazy.
const loaderLists = new Set(['tui/opentui/shell/pluginViews.ts', 'components/shell/pluginViews.ts'])
for (const dir of ['app', 'components', 'tui', 'lib', 'bin']) {
  for (const file of walk(path.join(root, dir))) {
    if (loaderLists.has(rel(file)) || /Smoke\.tsx?$/.test(file)) continue
    for (const specifier of importsOf(file)) {
      const target = resolve(file, specifier)
      if (!path.isAbsolute(target)) continue
      const targetRel = rel(target)
      if (targetRel.startsWith('plugins/') && !/\/manifest(\.ts)?$/.test(targetRel)) deny(file, specifier, 'only a renderer loader list may import a plugin view; import its manifest via lib/plugins/catalog')
    }
  }
}

assert.deepEqual(violations, [], `plugin import boundaries:\n${violations.join('\n')}`)
console.log(`plugin boundaries: PASS (${walk(pluginsDir).length} plugin files)`)
