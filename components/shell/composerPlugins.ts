import type { ComponentType } from 'react'
import type { ComposerAccessoryProps } from '../../lib/plugins/composer'
import { createPluginComposerRegistry } from '../../lib/plugins/composerHost'
import { PLUGIN_MANIFESTS } from '../../lib/plugins/catalog'
export const webComposerPlugins = createPluginComposerRegistry<ComponentType<ComposerAccessoryProps>>('web', PLUGIN_MANIFESTS, {
  tips: async () => (await import('../../plugins/tips/web')).composer,
  better: async () => (await import('../../plugins/better/web')).composer,
  'skill-picker': async () => (await import('../../plugins/skill-picker/web/composer')).composer,
  goals: async () => (await import('../../plugins/goals/web')).composer,
})
