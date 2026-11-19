import { useMemo, useSyncExternalStore } from 'react'
import { localPluginsVersion, subscribeLocalPlugins } from './catalog'
import { useDisabledPlugins } from './useDisabledPlugins'
import { listPluginComposerSlashCommands } from './composerSlash'
import type { PluginRenderer } from './types'
import type { AgentProvider } from '../types'
/** Suggestions react to enablement and late local-mod discovery in both apps. */
export function useComposerSlashCommands(renderer: PluginRenderer, provider?: AgentProvider) {
  const disabled = useDisabledPlugins()
  const version = useSyncExternalStore(subscribeLocalPlugins, localPluginsVersion, localPluginsVersion)
  return useMemo(() => listPluginComposerSlashCommands(renderer, provider), [renderer, provider, disabled, version])
}
