import { PLUGIN_API_VERSION, type PluginManifest } from '../../lib/plugins/types'

export const manifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'pi-interview',
  title: 'Pi Interview',
  description: 'Let Pi ask for several decisions in one in-app form.',
  enabledByDefault: false,
  renderers: ['web', 'tui'],
  stateVersion: 1,
  surfaces: [],
  commands: [],
} as const satisfies PluginManifest
