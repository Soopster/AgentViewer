import type { ComponentType } from 'react'
import type { ComposerAccessoryProps } from '../../lib/plugins/composer'
import { createPluginComposerRegistry } from '../../lib/plugins/composerHost'
import { PLUGIN_MANIFESTS } from '../../lib/plugins/catalog'
export const webComposerPlugins = createPluginComposerRegistry<ComponentType<ComposerAccessoryProps>>('web', PLUGIN_MANIFESTS, {
  better: async () => (await import('../../plugins/better/web')).composer,
  goals: async () => (await import('../../plugins/goals/web')).composer,
})
