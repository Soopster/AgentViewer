'use client'
import dynamic from 'next/dynamic'
import { listPluginCommands } from '../../lib/plugins/catalog'
import { cn } from '../../lib/utils'
import { nativeSelectBaseClassName } from '../ui/native-select'

export const PluginSurfaceHost = dynamic(() => import('../shell/PluginSurfaceHost'), { ssr: false })
// Feature plugins that put a button on the session toolbar.
export const WEB_TOOLBAR_PLUGIN_COMMANDS = listPluginCommands('web').filter((command) => command.webToolbarLabel)
export const PromptLibrary = dynamic(() => import('../PromptLibrary'), { ssr: false })
export const ChannelBridgePanel = dynamic(() => import('../ChannelBridgePanel'), { ssr: false })
export const IdeBridgePanel = dynamic(() => import('../IdeBridgePanel'), { ssr: false })
export const DiffReviewMode = dynamic(() => import('../DiffReviewMode'), { ssr: false })
export const PierrePatchDiffView = dynamic(() => import('../PierreDiffView').then((mod) => mod.PierrePatchDiffView), {
  ssr: false,
  loading: () => (
    <pre style={{ margin: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, background: 'rgba(0,0,0,0.18)', padding: '5px 7px', borderRadius: 4, maxHeight: 180, overflow: 'auto' }}>
      Loading diff…
    </pre>
  ),
})
export const compactNativeSelectClassName = cn(
  nativeSelectBaseClassName,
  'h-[30px] min-w-0 rounded-[5px] border-[var(--border)] bg-[var(--surface-2)] px-[10px] text-[11px] text-[var(--text)]'
)
export const CLAUDE_DIAGNOSTIC_ACTIONS = [
  ['reloadPlugins', 'reload-plugins', 'RELOAD PLUGINS', 'Plugins reloaded.', 'Reload plugins from disk'],
  ['reloadSkills', 'reload-skills', 'RELOAD SKILLS', 'Skills reloaded.', 'Reload skills from disk'],
  ['resolveSettings', 'resolve-settings', 'RESOLVE SETTINGS', 'Settings resolved.', 'Resolve effective Claude settings'],
] as const
export function claudeDiagnosticActionNotice(
  action: string,
  fallback: string,
  result: Record<string, unknown>): string {
  if (action === 'setMcpServers') {
    const authRequired = Array.isArray(result.authRequired)
      ? result.authRequired.filter((name): name is string => typeof name === 'string')
      : []
    const errors = result.errors && typeof result.errors === 'object' && !Array.isArray(result.errors)
      ? Object.keys(result.errors)
      : []
    if (authRequired.length > 0) return `${fallback} Authentication required: ${authRequired.join(', ')}.`
    if (errors.length > 0) return `${fallback} Connection failed: ${errors.join(', ')}.`
    return fallback
  }
  if (action !== 'resolveSettings') return fallback
  const sources = typeof result.sourceCount === 'number'
    ? result.sourceCount
    : Array.isArray(result.sources) ? result.sources.length : null
  const effective = typeof result.effectiveKeyCount === 'number'
    ? result.effectiveKeyCount
    : Array.isArray(result.effectiveKeys) ? result.effectiveKeys.length : null
  if (sources == null && effective == null) return fallback
  return `Settings resolved${sources == null ? '' : ` · ${sources} source${sources === 1 ? '' : 's'}`}${effective == null ? '' : ` · ${effective} effective key${effective === 1 ? '' : 's'}`}`
}
