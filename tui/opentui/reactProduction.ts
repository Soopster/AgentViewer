// React's production build for the TUI, without NODE_ENV.
//
// Bun leaves NODE_ENV unset, so React, its reconciler and the scheduler all
// load their development builds: an owner-stack `Error` per JSX element, debug
// fields on every fiber, and dev-only validation on every render. Measured on
// the main isolate after browsing: 11,519 retained `Error` objects (12.7MB)
// alone. Setting NODE_ENV=production process-wide was tried and reverted —
// every other module the app loads reads it too (see CLAUDE.md). This is
// scoped to React: a runtime plugin rewrites exactly React's CommonJS entry
// shims to require their production builds, and nothing else sees a changed
// environment.
//
// It must be installed before anything imports React, which is why main.tsx
// imports this and then loads the app dynamically. Bun compiles the TUI's JSX
// to `jsxDEV`, which React's production dev-runtime deliberately leaves
// undefined, so that entry maps it onto the production `jsx` (in production
// `jsx` and `jsxs` are the same function; the extra dev arguments are
// debug-only).
//
// AGENT_VIEWER_TUI_REACT_DEV=1 keeps the development build, for debugging.
import path from 'node:path'

const REACT_ENTRIES: Record<string, string> = {
  'react/index.js': 'cjs/react.production.js',
  'react/jsx-runtime.js': 'cjs/react-jsx-runtime.production.js',
  'react-reconciler/index.js': 'cjs/react-reconciler.production.js',
  'react-reconciler/constants.js': 'cjs/react-reconciler-constants.production.js',
  'scheduler/index.js': 'cjs/scheduler.production.js',
}

export function installReactProductionBuild(): boolean {
  if (process.env.AGENT_VIEWER_TUI_REACT_DEV === '1') return false
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'production') return false
  const bun = (globalThis as { Bun?: { plugin(plugin: unknown): void } }).Bun
  if (!bun) return false
  bun.plugin({
    name: 'agent-viewer-react-production',
    setup(build: {
      onLoad(options: { filter: RegExp }, callback: (args: { path: string }) => { contents: string; loader: 'js' } | undefined): void
    }) {
      build.onLoad(
        { filter: /[\\/]node_modules[\\/](react|react-reconciler|scheduler)[\\/](index|jsx-runtime|jsx-dev-runtime|constants)\.js$/ },
        (args) => {
          const parts = args.path.split(/[\\/]/)
          const entry = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
          const dir = path.dirname(args.path)
          const isDevRuntime = entry === 'react/jsx-dev-runtime.js'
          const target = isDevRuntime ? 'cjs/react-jsx-runtime.production.js' : REACT_ENTRIES[entry]
          if (!target) return undefined
          // Plugin contents are loaded as ES modules, so re-export the
          // production build's own keys rather than assigning module.exports.
          const file = path.join(dir, target)
          const keys = Object.keys(require(file) as object).filter((key) => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key))
          const lines = [
            `import production from ${JSON.stringify(file)};`,
            ...keys.map((key) => `export const ${key} = production.${key};`),
          ]
          if (isDevRuntime) {
            lines.push('export function jsxDEV(type, config, maybeKey) { return production.jsx(type, config, maybeKey); }')
            lines.push(`export default { ...production, jsxDEV };`)
          } else {
            lines.push('export default production;')
          }
          return { loader: 'js', contents: lines.join('\n') }
        },
      )
    },
  })
  return true
}

installReactProductionBuild()
