// `agent-viewer cards …`: validate, preview and switch the transcript card rules the Adaptive UI draws
// (lib/plugins/cardTemplates.ts). It is how an agent that just wrote a rule file learns, at once and in
// words, whether the file is usable — and how a person flips one without opening the app.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { cardBlockLines } from '../lib/plugins/cardBlocks'
import { parseCardRule, renderCardRule } from '../lib/plugins/cardTemplates'
import { loadCardRules, recipesDir, setCardRuleStatus } from '../lib/adaptiveUi/store'

const [verb, ...args] = process.argv.slice(2)
const json = args.includes('--json')
const rest = args.filter(arg => arg !== '--json')
const out = (value: unknown, text: string) => console.log(json ? JSON.stringify(value) : text)
function usage(): never { throw Object.assign(new Error('Usage: agent-viewer cards check [file…] | preview <file-or-id> | list | enable <id> | disable <id> [--json]'), { code: 2 }) }

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
