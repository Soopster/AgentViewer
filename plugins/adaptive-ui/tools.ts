// What an agent can do with cards, as tools: look at what is drawn generically and what history says about it, propose a
// card and get its problems back at once, patch one against a revision, and preview it. Everything an agent writes is a
// draft; nothing here can enable a card, replace a built-in one, or delete anything.
import type { PluginToolHandler } from '../../lib/plugins/behavior'
import { cardBlockLines } from '../../lib/plugins/cardBlocks'
import { parseCardRule, renderCardRule } from '../../lib/plugins/cardTemplates'
import { corpusProfileText, loadCorpus, profileCoverage } from '../../lib/adaptiveUi/corpus'
import { adaptiveUiSnapshot } from '../../lib/adaptiveUi/runtime'
import { explainRule, explanationLines } from '../../lib/adaptiveUi/explain'
import { currentRevision, parseCardPatch } from '../../lib/adaptiveUi/patch'
import { ruleCoverage, sampleCalls } from '../../lib/adaptiveUi/coverage'
import { loadCardRules, patchCardRule, writeCardRule } from '../../lib/adaptiveUi/store'
import { CARD_VOCABULARY, vocabularyMarkdown } from '../../lib/adaptiveUi/vocabulary'

const ruleOf = (id: string) => { const rule = loadCardRules().rules.find(entry => entry.id === id); if (!rule) throw new Error(`no card rule "${id.slice(0, 64)}" (yours: ${loadCardRules().rules.map(entry => entry.id).join(', ') || 'none'})`); return rule }
const json = (text: string, what: string) => { try { return JSON.parse(text) as unknown } catch (error) { throw new Error(`${what} is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`) } }

export const adaptiveUiToolHandlers: Record<string, PluginToolHandler> = {
  list_shapes: args => {
    const snapshot = adaptiveUiSnapshot()
    const rows = snapshot.shapes.filter(shape => !shape.dismissed && !snapshot.rules.some(rule => rule.match.tool === shape.tool)).slice(0, Number(args.limit ?? 15))
    return rows.length ? rows.map(shape => `${shape.tool}  ${shape.count} calls · keys: ${shape.inputKeys.join(', ') || 'none'} · ${shape.samples.length} samples${snapshot.knowledge.tools[shape.tool] ? ` · history: ${snapshot.knowledge.tools[shape.tool]}` : ''}`).join('\n') : 'Nothing is drawn generically yet (or every such tool has a card).'
  },
  profile: args => { const tool = loadCorpus().tools[String(args.tool)]; if (!tool) throw new Error(`nothing is known about "${String(args.tool).slice(0, 80)}": it is built in, never seen, or past sessions have not been read yet (the person can run "learn from history")`); return corpusProfileText(tool) },
  schema: () => vocabularyMarkdown() + `\n\nA rule: { "id", "status": "draft", "match": { "tool" }, "title", "tone", "blocks" } (authority: ${CARD_VOCABULARY.authority}).`,
  show_rule: args => { const rule = ruleOf(String(args.id)); return JSON.stringify({ ...rule, revision: currentRevision(rule) }, null, 2) },
  propose_rule: args => {
    const raw = json(String(args.rule_json), 'rule_json') as Record<string, unknown>
    // Whatever the agent wrote, it is a draft, and it cannot ask to replace a built-in card.
    const parsed = parseCardRule({ ...raw, status: 'draft', overridesNative: undefined, provenance: { by: 'agent' } })
    if (!parsed.rule) throw new Error(`refused: ${parsed.problems.join('; ')}`)
    const against = profileCoverage(parsed.rule, loadCorpus().tools[parsed.rule.match.tool])
    if (against.never.length) throw new Error(`refused against past calls: ${against.never.join('; ')}. Use fields listed by the profile tool.`)
    const stored = writeCardRule(parsed.rule, undefined, { actor: 'agent', action: 'create', summary: `proposed ${parsed.rule.id}` })
    const warnings = [...ruleCoverage(stored, sampleCalls(stored)).warnings, ...against.rare]
    return `Saved ${stored.id} as a draft (revision ${stored.revision}). The person keeps or discards it; you cannot enable it.${warnings.length ? `\nWarnings:\n${warnings.map(warning => `- ${warning}`).join('\n')}` : ''}`
  },
  patch_rule: args => {
    const { patch, problems } = parseCardPatch(json(String(args.patch_json), 'patch_json'))
    if (!patch) throw new Error(`refused: ${problems.join('; ')}`)
    const rule = patchCardRule(String(args.id), patch, 'agent')
    return `${rule.id} is now revision ${rule.revision} and a draft.`
  },
  preview_rule: args => {
    const rule = ruleOf(String(args.id))
    const cards = sampleCalls(rule).map(call => renderCardRule(rule, call))
    const warnings = [...ruleCoverage(rule, sampleCalls(rule)).warnings, ...(() => { const against = profileCoverage(rule, loadCorpus().tools[rule.match.tool]); return [...against.never, ...against.rare] })()]
    return [
      ...(cards.length ? cards.map((card, index) => `sample ${index + 1} [${card.tone}] ${card.title}\n${cardBlockLines(card.blocks).map(line => `  ${line}`).join('\n')}`) : ['(no samples to preview)']),
      ...(warnings.length ? ['', ...warnings.map(warning => `warning: ${warning}`)] : []), '', ...explanationLines(explainRule(rule)).slice(0, 8),
    ].join('\n')
  },
}
