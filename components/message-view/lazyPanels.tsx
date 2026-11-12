'use client'
import dynamic from 'next/dynamic'
import { listPluginCommands } from '../../lib/plugins/catalog'
import { cn } from '../../lib/utils'
import { nativeSelectBaseClassName } from '../ui/native-select'

export const PluginSurfaceHost = dynamic(() => import('../shell/PluginSurfaceHost'), { ssr: false })
// Feature plugins that put a button on the session toolbar.
export const WEB_TOOLBAR_PLUGIN_COMMANDS = listPluginCommands('web').filter((command) => command.webToolbarLabel)
export const WEB_COMPOSER_PLUGIN_COMMANDS = listPluginCommands('web').filter((command) => command.webComposerLabel)
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
