import type { ComponentType } from 'react'
import type { ComposerAccessoryProps } from '../../../lib/plugins/composer'
import type { TuiThemePalette } from './sdk'
import { createPluginComposerRegistry } from '../../../lib/plugins/composerHost'
import { PLUGIN_MANIFESTS } from '../../../lib/plugins/catalog'
export type TuiComposerAccessoryProps = ComposerAccessoryProps & { readonly theme: TuiThemePalette; readonly width: number; readonly viewportWidth: number; readonly height: number; readonly marginLeft: number; readonly modalZIndex: number }
export const tuiComposerPlugins = createPluginComposerRegistry<ComponentType<TuiComposerAccessoryProps>>('tui', PLUGIN_MANIFESTS, {
  better: async () => (await import('../../../plugins/better/tui')).composer,
  goals: async () => (await import('../../../plugins/goals/tui')).composer,
})
