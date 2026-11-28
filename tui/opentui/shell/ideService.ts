import type { PluginIdeService } from '../../../lib/plugins/openInIde'
// Always native, attached or not: the editor opens on the machine this terminal is on,
// and the choice is this machine's tui.json. Loaded on first use.
const native = () => import('../../../lib/ide/service').then(module => module.nativeIde)
export const tuiIde: PluginIdeService = {
  read: async signal => (await native()).read(signal),
  setPreference: async ide => (await native()).setPreference(ide),
  open: async input => (await native()).open(input),
}
