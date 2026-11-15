import { watch, type FSWatcher } from 'node:fs'
import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { hasNativeToolCard } from '../../lib/plugins/nativeTools'
import { cardRuleMatches, cardRuleSpecificity, mcpServerOf, renderCardRule } from '../../lib/plugins/cardTemplates'
import { clearPluginToolCardCache } from '../../lib/plugins/toolCards'
import { recipesDir } from '../../lib/adaptiveUi/store'
import { effectiveRules, noteInteraction, noteToolCompleted, recordShape } from '../../lib/adaptiveUi/runtime'
import { redactForSample, redactResultJson, redactResultText } from '../../lib/adaptiveUi/shapes'

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
  counted.clear()
  if (debounce) { clearTimeout(debounce); debounce = null }
  watcher?.close(); watcher = null; watchedDir = ''
}

/**
 * A call is counted once. The same call is presented again under another provider-instance key, after the
 * card cache evicts it, or from another window of the transcript; counting each presentation made a tool
 * called twice read as called six times (seen live).
 */
const counted = new Set<string>()
const COUNTED_MAX = 5_000
function firstSighting(sessionId: string, callId: string): boolean {
  const key = `${sessionId}:${callId}`
  if (counted.has(key)) return false
  if (counted.size >= COUNTED_MAX) counted.delete(counted.values().next().value!)
  counted.add(key)
  return true
}

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'adaptive-ui',
  toolCard({ target, tool, result }) {
    ensureWatching()
    const context = { tool: { name: tool.name, input: tool.input }, ...(result ? { result: { text: result.text, isError: result.isError, ...(result.json !== undefined ? { json: result.json } : {}) } } : {}) }
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
    // No active rule. A draft that matches is offered as a labelled preview beside the built-in card, so a person can judge it on a real call.
    let draft: ReturnType<typeof effectiveRules>['rules'][number] | null = null
    for (const rule of effectiveRules().rules) {
      if (rule.status !== 'draft' || rule.match.kind === 'system' || (native && !rule.overridesNative) || !cardRuleMatches(rule, context)) continue
      if (!draft || cardRuleSpecificity(rule) > cardRuleSpecificity(draft)) draft = rule
    }
    const preview = draft ? renderCardRule(draft, context) : null
    // Nothing draws this specially: remember its shape, and a redacted sample once the call has finished.
    if (!native && result && firstSighting(target.sessionId, tool.id)) {
      const inputKeys = Object.keys(tool.input ?? {}).filter(key => /^[A-Za-z0-9_-]{1,64}$/.test(key)).sort().slice(0, 24)
      const server = mcpServerOf(tool.name)
      recordShape({ tool: tool.name, ...(server ? { mcpServer: server } : {}), inputKeys, sample: { input: redactForSample(tool.input) as Record<string, unknown>, result: { text: result.json !== undefined ? redactResultJson(result.json) : redactResultText(result.text), isError: result.isError } } })
    }
    return draft && preview ? { title: preview.title, blocks: preview.blocks, tone: preview.tone, draft: true, ref: draft.id } : null
  },
  deactivate: closeRecipeWatcher,
  transcriptCard({ block }) {
    ensureWatching()
    // A failed system message is an error whatever a rule says, as a failed tool call is.
    const failed = block.payload.level === 'error' || typeof block.payload.error === 'string'
    const context = { kind: 'system' as const, tool: { name: block.subtype, input: block.payload }, result: { text: '', isError: failed } }
    let best: ReturnType<typeof effectiveRules>['rules'][number] | null = null
    for (const rule of effectiveRules().rules) {
      if (rule.status !== 'active' || rule.match.kind !== 'system' || !cardRuleMatches(rule, context)) continue
      if (!best || cardRuleSpecificity(rule) > cardRuleSpecificity(best)) best = rule
    }
    if (!best) return null
    const card = renderCardRule(best, context)
    return { title: card.title, blocks: card.blocks, tone: card.tone }
  },
  runtimeEvent({ event }) {
    if (event.type === 'tool.completed' && event.tool?.name) noteToolCompleted(event.tool.name, event.tool.failed === true)
    else if (event.type === 'ui.interaction' && event.interaction) noteInteraction(event.interaction.subject, event.interaction.action, event.interaction.count)
  },
}
