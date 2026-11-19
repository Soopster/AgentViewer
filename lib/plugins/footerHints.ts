// Key hints plugins add to the terminal's status bar (PluginManifest.hints).
// Pure reads of the catalog and the enablement store; the bar decides what fits.
import { allPluginManifests } from './catalog'
import { isPluginEnabled } from './enablement'
import type { PluginHintSpec } from './types'

export type FooterHintContext = PluginHintSpec['context']

/** The enabled plugins' hints for a pane, in order, as [key, label] pairs. */
export function pluginFooterHints(context: FooterHintContext): Array<[string, string]> {
  return allPluginManifests()
    .filter(manifest => manifest.hints?.length && isPluginEnabled(manifest.id))
    .flatMap(manifest => (manifest.hints ?? []).filter(hint => hint.context === context))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    .map((hint): [string, string] => [hint.key, hint.label])
}
