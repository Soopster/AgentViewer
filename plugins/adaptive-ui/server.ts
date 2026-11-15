import { watch, type FSWatcher } from 'node:fs'
import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { hasNativeToolCard } from '../../lib/plugins/nativeTools'
import { cardRuleMatches, cardRuleSpecificity, mcpServerOf, renderCardRule } from '../../lib/plugins/cardTemplates'
import { clearPluginToolCardCache } from '../../lib/plugins/toolCards'
import { recipesDir } from '../../lib/adaptiveUi/store'
import { effectiveRules, noteInteraction, noteToolCompleted, recordShape } from '../../lib/adaptiveUi/runtime'
import { redactForSample, redactResultText } from '../../lib/adaptiveUi/shapes'

// A rule edited on disk (by an agent, by hand) must reach cards already cached,
// so the recipes directory is watched and the card cache cleared when it changes.
let watcher: FSWatcher | null = null
let watchedDir = ''
let debounce: ReturnType<typeof setTimeout> | null = null
function ensureWatching(): void {
  const dir = recipesDir()
  if (watcher && watchedDir === dir) return
  watcher?.close(); watcher = null; watchedDir = dir
  try {
    watcher = watch(dir, () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(() => { debounce = null; clearPluginToolCardCache() }, 200); debounce.unref?.() })
    watcher.unref?.()
    watcher.on('error', () => { watcher?.close(); watcher = null })
  } catch { /* the directory does not exist yet: it is watched again on the next call, once a rule has been written */ }
}

/** A reload disposes the behavior host: stop watching and drop pending work so a fresh host starts clean. */
function closeRecipeWatcher(): void {
  if (debounce) { clearTimeout(debounce); debounce = null }
  watcher?.close(); watcher = null; watchedDir = ''
}

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'adaptive-ui',
  toolCard({ tool, result }) {
    ensureWatching()
    const context = { tool: { name: tool.name, input: tool.input }, ...(result ? { result: { text: result.text, isError: result.isError } } : {}) }
    const native = hasNativeToolCard(tool.name)
    let best: ReturnType<typeof effectiveRules>['rules'][number] | null = null
    for (const rule of effectiveRules().rules) {
      if (rule.status !== 'active' || (native && !rule.overridesNative) || !cardRuleMatches(rule, context)) continue
      if (!best || cardRuleSpecificity(rule) > cardRuleSpecificity(best)) best = rule
    }
    if (best) {
      const card = renderCardRule(best, context)
      return { title: card.title, blocks: card.blocks, tone: card.tone }
    }
    // Nothing draws this specially: remember its shape, and a redacted sample once the call has finished.
    if (!native && result) {
      const inputKeys = Object.keys(tool.input ?? {}).filter(key => /^[A-Za-z0-9_-]{1,64}$/.test(key)).sort().slice(0, 24)
      const server = mcpServerOf(tool.name)
      recordShape({ tool: tool.name, ...(server ? { mcpServer: server } : {}), inputKeys, sample: { input: redactForSample(tool.input) as Record<string, unknown>, result: { text: redactResultText(result.text), isError: result.isError } } })
    }
    return null
  },
  deactivate: closeRecipeWatcher,
  runtimeEvent({ event }) {
    if (event.type === 'tool.completed' && event.tool?.name) noteToolCompleted(event.tool.name, event.tool.failed === true)
    else if (event.type === 'ui.interaction' && event.interaction) noteInteraction(event.interaction.subject, event.interaction.action, event.interaction.count)
  },
}
