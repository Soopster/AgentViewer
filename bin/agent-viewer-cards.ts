// `agent-viewer cards …`: validate, preview and switch the transcript card rules the Adaptive UI draws
// (lib/plugins/cardTemplates.ts). It is how an agent that just wrote a rule file learns, at once and in
// words, whether the file is usable — and how a person flips one without opening the app.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { cardBlockLines } from '../lib/plugins/cardBlocks'
import { parseCardRule, renderCardRule } from '../lib/plugins/cardTemplates'
import { loadCardRules, patchCardRule, recipesDir, setCardRuleStatus } from '../lib/adaptiveUi/store'
import { explainRule, explanationLines } from '../lib/adaptiveUi/explain'
import { readCardHistory } from '../lib/adaptiveUi/history'
import { currentRevision, parseCardPatch } from '../lib/adaptiveUi/patch'
import { CARD_VOCABULARY, vocabularyMarkdown } from '../lib/adaptiveUi/vocabulary'

const [verb, ...args] = process.argv.slice(2)
const json = args.includes('--json')
const rest = args.filter(arg => arg !== '--json')
const out = (value: unknown, text: string) => console.log(json ? JSON.stringify(value) : text)
function usage(): never { throw Object.assign(new Error('Usage: agent-viewer cards check [file…] | preview <file-or-id> | show <id> | explain <id> | patch <id> <patch.json|-> | refine <id> "<instruction>" | history [id] | schema | list | enable <id> | disable <id> [--json]'), { code: 2 }) }

function readRule(target: string) {
  const file = existsSync(target) ? target : path.join(recipesDir(), target.endsWith('.json') ? target : `${target}.json`)
  const parsed = parseCardRule(JSON.parse(readFileSync(file, 'utf8')))
  return { file, ...parsed }
}

try {
  if (verb === 'check') {
    const targets = rest.length ? rest : loadCardRules().invalid.length || loadCardRules().rules.length ? [...loadCardRules().rules.map(rule => `${rule.id}.json`), ...loadCardRules().invalid.map(entry => entry.file)] : []
    const results = targets.map(target => { try { const r = readRule(target); return { file: r.file, valid: !!r.rule, problems: r.problems } } catch (error) { return { file: target, valid: false, problems: [error instanceof Error ? error.message : String(error)] } } })
    out(results, results.length ? results.map(r => r.valid ? `ok       ${r.file}` : `INVALID  ${r.file}\n${r.problems.map(problem => `           - ${problem}`).join('\n')}`).join('\n') : `no rule files in ${recipesDir()}`)
    process.exitCode = results.every(r => r.valid) ? 0 : 1
  } else if (verb === 'preview') {
    if (rest.length !== 1) usage()
    const { rule, problems, file } = readRule(rest[0]!)
    if (!rule) { out({ file, problems }, `INVALID ${file}\n${problems.map(problem => `  - ${problem}`).join('\n')}`); process.exitCode = 1 }
    else {
      const cards = (rule.samples ?? []).map(sample => renderCardRule(rule, { tool: { name: rule.match.tool.replace(/\*/g, 'x'), input: sample.input }, ...(sample.result ? { result: { text: sample.result.text, isError: sample.result.isError === true } } : {}) }))
      out(cards, cards.length ? cards.map((card, i) => `sample ${i + 1}  [${card.tone}]  ${card.title}\n${cardBlockLines(card.blocks).map(line => `  ${line}`).join('\n')}`).join('\n\n') : `${rule.id} is valid but has no samples to preview`)
    }
  } else if (verb === 'show') {
    if (rest.length !== 1) usage()
    const rule = loadCardRules().rules.find(entry => entry.id === rest[0])
    if (!rule) throw new Error(`no card rule "${rest[0]!.slice(0, 64)}"`)
    console.log(JSON.stringify({ ...rule, revision: currentRevision(rule) }, null, 2))
  } else if (verb === 'explain') {
    if (rest.length !== 1) usage()
    const rule = loadCardRules().rules.find(entry => entry.id === rest[0])
    if (!rule) throw new Error(`no card rule "${rest[0]!.slice(0, 64)}"`)
    const explanation = explainRule(rule)
    out(explanation, explanationLines(explanation).join('\n'))
  } else if (verb === 'patch') {
    if (rest.length !== 2) usage()
    const raw = rest[1] === '-' ? readFileSync(0, 'utf8') : readFileSync(rest[1]!, 'utf8')
    const { patch, problems } = parseCardPatch(JSON.parse(raw))
    if (!patch) { out({ problems }, `INVALID PATCH\n${problems.map(problem => `  - ${problem}`).join('\n')}`); process.exitCode = 1 }
    else {
      try { const rule = patchCardRule(rest[0]!, patch, 'agent'); out({ id: rule.id, revision: rule.revision, status: rule.status }, `${rule.id} is now revision ${rule.revision} and a draft. Run: agent-viewer cards preview ${rule.id}`) }
      catch (error) { out({ error: error instanceof Error ? error.message : String(error), conflict: error instanceof Error && error.name === 'PatchConflictError' }, error instanceof Error ? error.message : String(error)); process.exitCode = error instanceof Error && error.name === 'PatchConflictError' ? 4 : 1 }
    }
  } else if (verb === 'refine') {
    if (rest.length !== 2) usage()
    const { refineHere } = await import('../lib/adaptiveUi/runtime')
    const message = await refineHere(rest[0]!, rest[1]!)
    out({ message }, message)
  } else if (verb === 'history') {
    const entries = readCardHistory(recipesDir(), { ...(rest[0] ? { id: rest[0] } : {}), limit: 30 })
    out(entries, entries.map(entry => `${entry.at.slice(0, 19)}  ${entry.actor.padEnd(5)} ${entry.action.padEnd(7)} ${entry.id}${entry.revision ? ` r${entry.revision}` : ''}  ${entry.summary}`).join('\n') || '(no history)')
  } else if (verb === 'schema') {
    out(CARD_VOCABULARY, vocabularyMarkdown())
  } else if (verb === 'list') {
    const { dir, rules, invalid } = loadCardRules()
    out({ dir, rules: rules.map(rule => ({ id: rule.id, status: rule.status, tool: rule.match.tool })), invalid }, `${dir}\n${rules.map(rule => `${rule.status.padEnd(8)} ${rule.id}  ${rule.match.tool}`).join('\n') || '(no rules)'}${invalid.length ? `\n\nrefused: ${invalid.map(entry => entry.file).join(', ')}` : ''}`)
  } else if (verb === 'enable' || verb === 'disable') {
    if (rest.length !== 1) usage()
    const rule = setCardRuleStatus(rest[0]!, verb === 'enable' ? 'active' : 'disabled')
    out({ id: rule.id, status: rule.status }, `${rule.id} is now ${rule.status}`)
  } else usage()
} catch (error) {
  const code = (error as { code?: number }).code === 2 ? 2 : 1
  console.error(json ? JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) : error instanceof Error ? error.message : String(error))
  process.exitCode = code
}
