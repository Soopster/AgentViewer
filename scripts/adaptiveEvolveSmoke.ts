// Rules change by checked patch against a revision, every change is recorded with who made it, a card can
// say why it is the way it is (and the host says what it can prove), and the person's decisions shape the next design.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = mkdtempSync(join(tmpdir(), 'adaptive-evolve-'))
const dir = join(root, 'recipes')
process.env.AGENT_VIEWER_UI_RECIPES_DIR = dir
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
const { writeCardRule, patchCardRule, setCardRuleStatus, deleteCardRule, loadCardRules } = await import('../lib/adaptiveUi/store')
const { applyCardPatch, parseCardPatch, PatchConflictError, PATCH_MAX_OPERATIONS } = await import('../lib/adaptiveUi/patch')
const { readCardHistory, appendCardHistory, preferenceHint, PREFERENCE_MIN_SIGNALS } = await import('../lib/adaptiveUi/history')
const { explainRule, explanationLines } = await import('../lib/adaptiveUi/explain')
const { refineCardWithModel, DESIGN_MAX_ATTEMPTS } = await import('../lib/adaptiveUi/design')
const { buildDesignPrompt, buildRefinePrompt } = await import('../lib/adaptiveUi/prompt')
const { parseCardRule } = await import('../lib/plugins/cardTemplates')

const base = { id: 'linear.get_issue', status: 'draft', match: { tool: 'mcp__linear__get_issue' }, title: '{{input.id}} · {{result.json.title}}', tone: 'info',
  blocks: [{ type: 'badge', text: '{{result.json.state}}' }, { type: 'kv', rows: [['Assignee', '{{result.json.assignee.name | default none}}']] }],
  rationale: { intent: 'See where an issue stands', choices: [{ block: 'badge', reason: 'state is the answer' }], alternatives: ['a table'], assumptions: ['the result is JSON'] } }

// Revisions belong to the host: 1 on creation, one more per write, whatever the writer claims.
let rule = writeCardRule({ ...base, revision: 99 }, dir, { actor: 'agent', action: 'create' })
assert.equal(rule.revision, 1)
rule = setCardRuleStatus('linear.get_issue', 'active', dir, 'user'); assert.equal(rule.revision, 2)
assert.equal(parseCardRule({ ...base, revision: 0 }).rule, null); assert.equal(parseCardRule({ ...base, revision: 1.5 }).rule, null)

// A patch applies to the revision it names and no other; the result is a draft; identity and target cannot move.
const ops = (...operations: unknown[]) => ({ baseRevision: 2, operations })
const patched = patchCardRule('linear.get_issue', parseCardPatch(ops({ op: 'set-title', title: '{{input.id}}' }, { op: 'insert-block', index: 1, block: { type: 'text', text: '{{result.text | truncate 40}}' } }, { op: 'remove-block', index: 0 })).patch!, 'agent', dir)
assert.equal(patched.revision, 3); assert.equal(patched.status, 'draft', 'a patched rule goes back to review, even one that was active')
assert.equal(patched.title, '{{input.id}}'); assert.deepEqual((patched.blocks as { type: string }[]).map(b => b.type), ['text', 'kv'], 'inserted at 1 then the badge removed')
assert.equal(patched.match.tool, 'mcp__linear__get_issue'); assert.equal(patched.id, 'linear.get_issue')
assert.throws(() => patchCardRule('linear.get_issue', parseCardPatch(ops({ op: 'set-title', title: 'late' })).patch!, 'agent', dir), (error: unknown) => error instanceof PatchConflictError && error.current === 3 && error.base === 2, 'a stale patch is a conflict, not an overwrite')
assert.equal(loadCardRules(dir).rules[0]!.title, '{{input.id}}')
const at3 = (...operations: unknown[]) => ({ baseRevision: 3, operations })
assert.throws(() => patchCardRule('linear.get_issue', parseCardPatch(at3({ op: 'replace-block', index: 9, block: { type: 'text', text: 'x' } })).patch!, 'agent', dir), /no block 9/)
assert.throws(() => patchCardRule('linear.get_issue', parseCardPatch(at3({ op: 'set-title', title: '{{input.x | eval}}' })).patch!, 'agent', dir), /invalid rule.*unknown formatter/)
assert.throws(() => patchCardRule('linear.get_issue', parseCardPatch(at3({ op: 'replace-block', index: 0, block: { type: 'button', text: 'x' } })).patch!, 'agent', dir), /invalid rule/, 'there is no operation that can add something that acts')
for (const bad of [null, { baseRevision: 0, operations: [{ op: 'set-title', title: 'x' }] }, { baseRevision: 1, operations: [] }, { baseRevision: 1, operations: Array.from({ length: PATCH_MAX_OPERATIONS + 1 }, () => ({ op: 'set-title', title: 'x' })) }, { baseRevision: 1, operations: [{ op: 'set-match', tool: '*' }] }, { baseRevision: 1, operations: [{ op: 'remove-block', index: -1 }] }]) assert.equal(parseCardPatch(bad).patch, null, JSON.stringify(bad).slice(0, 60))
assert.equal(readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0)

// Every change is on the record with who made it; the record survives torn lines and stays bounded.
deleteCardRule('linear.get_issue', dir, 'user')
const history = readCardHistory(dir, { id: 'linear.get_issue' })
assert.deepEqual(history.map(entry => `${entry.actor}:${entry.action}:r${entry.revision}`), ['user:delete:r3', 'agent:patch:r3', 'user:enable:r2', 'agent:create:r1'])
assert.deepEqual(history[0]!.blockTypes, ['text', 'kv'], 'a deleted rule leaves what it was made of')
appendFileSync(join(dir, '.history.jsonl'), '{ torn\n{"id":"x","at":"t","actor":"robot","action":"create","summary":"s"}\n')
assert.equal(readCardHistory(dir).every(entry => ['user', 'model', 'agent', 'cli', 'mod'].includes(entry.actor)), true, 'torn lines and unknown actors are skipped')
for (let i = 0; i < 3_000; i++) appendCardHistory(dir, { id: 'bulk', actor: 'cli', action: 'create', summary: 'x'.repeat(200) })
assert.ok(readFileSync(join(dir, '.history.jsonl'), 'utf8').length < 400 * 1024, 'the history is rotated')
assert.equal(loadCardRules(dir).invalid.length, 0, 'the history is not mistaken for a rule file')

// Explanation: what the host can prove is separate from what the designer claimed.
rule = writeCardRule(base, dir, { actor: 'agent', action: 'create' })
const explained = explainRule(rule)
assert.deepEqual(explained.derived.reads, ['input.id', 'result.json.title', 'result.json.state', 'result.json.assignee.name'])
assert.deepEqual(explained.derived.blocks.map(block => block.type), ['badge', 'kv']); assert.ok(explained.derived.cannot.includes('add a button or any control'))
assert.equal(explained.declared.intent, 'See where an issue stands'); assert.deepEqual(explained.declared.alternatives, ['a table'])
const lines = explanationLines(explained).join('\n')
assert.ok(lines.indexOf('Derived from the rule') < lines.indexOf('Declared by') && lines.includes('a claim, not checked'))
assert.ok(!JSON.stringify(explained.derived).includes('state is the answer'), 'the designer’s reasons never pass for derived facts')
const hostile = parseCardRule({ ...base, rationale: { intent: `x\u001b[31m${'y'.repeat(900)}`, choices: Array.from({ length: 40 }, () => ({ block: 'b', reason: 'r' })), alternatives: [1, 'ok'], assumptions: 'nope' } }).rule!.rationale!
assert.ok(!hostile.intent!.includes('\u001b') && hostile.intent!.length <= 300 && hostile.choices!.length <= 12 && hostile.alternatives!.length === 1 && hostile.assumptions === undefined)

// Preferences need evidence, then say what was kept and what was removed.
assert.equal(preferenceHint([], []), null); assert.equal(PREFERENCE_MIN_SIGNALS, 3)
assert.equal(preferenceHint([{ at: 'x', id: 'a', actor: 'user', action: 'delete', summary: '', blockTypes: ['table'] }], [['badge']]), null, 'two decisions are not a preference')
const gone = (id: string, blockTypes: string[]) => ({ at: `2026-01-0${id}`, id, actor: 'user' as const, action: 'delete' as const, summary: '', blockTypes })
const hint = preferenceHint([gone('1', ['table', 'text']), gone('2', ['table'])], [['badge', 'kv'], ['badge']])!
assert.ok(hint.includes('keep cards that use badge, kv') && hint.includes('removed cards that used table, text'), hint)
assert.equal(preferenceHint([{ ...gone('3', ['table']), actor: 'model' }], [['badge'], ['kv'], ['badge']]), 'This person\'s earlier decisions: they keep cards that use badge, kv. Prefer the former unless the data clearly needs the latter.', 'only the person\'s own decisions count against a block type')
assert.ok(buildDesignPrompt({ tool: 'mcp__a__b', inputKeys: [], samples: [] }, dir, hint).includes(hint), 'the hint reaches the design request')
assert.ok(buildRefinePrompt({ id: 'x', revision: 4 }, dir).includes('cards patch x') && buildRefinePrompt({ id: 'x', revision: 4 }, dir).includes('revision 4'))

// Plain-language change through a model: a patch, checked against the revision read first.
let current = loadCardRules(dir).rules.find(entry => entry.id === 'linear.get_issue')!
const prompts: string[] = []
const refined = await refineCardWithModel(current, 'drop the badge', async ({ prompt }) => { prompts.push(prompt); return prompts.length === 1 ? 'sure thing' : '```json\n{"operations":[{"op":"remove-block","index":0}]}\n```' }, { dir })
assert.equal(prompts.length, 2); assert.ok(prompts[1]!.includes('refused') || prompts[1]!.includes('could not be used'))
assert.equal(refined.status, 'draft'); assert.equal((refined.blocks as unknown[]).length, 1)
assert.deepEqual(readCardHistory(dir, { id: 'linear.get_issue', limit: 1 }).map(entry => `${entry.actor}:${entry.action}`), ['model:patch'])
current = loadCardRules(dir).rules.find(entry => entry.id === 'linear.get_issue')!
await assert.rejects(refineCardWithModel(current, 'rename', async () => { setCardRuleStatus('linear.get_issue', 'active', dir, 'user'); return '{"operations":[{"op":"set-title","title":"x"}]}' }, { dir }), PatchConflictError)
let tries = 0
await assert.rejects(refineCardWithModel(loadCardRules(dir).rules[0]!, 'x', async () => { tries++; return 'no' }, { dir }), /usable change/); assert.equal(tries, DESIGN_MAX_ATTEMPTS)
await assert.rejects(refineCardWithModel(current, '   ', async () => ''), /what to change/)

// The command line: the words an agent reads, and an exit code that says "conflict".
const env = { ...process.env, AGENT_VIEWER_UI_RECIPES_DIR: dir }
const cli = (args: string[], input?: string) => { const r = spawnSync(process.execPath, ['run', fileURLToPath(new URL('../bin/agent-viewer-cards.ts', import.meta.url)), ...args], { env, encoding: 'utf8', input }); return { code: r.status, out: r.stdout, err: r.stderr } }
const shown = JSON.parse(cli(['show', 'linear.get_issue']).out); assert.ok(shown.revision >= 1)
const okPatch = cli(['patch', 'linear.get_issue', '-'], JSON.stringify({ baseRevision: shown.revision, operations: [{ op: 'set-title', title: 'by cli' }] }))
assert.equal(okPatch.code, 0, okPatch.err); assert.ok(okPatch.out.includes('a draft'))
const stale = cli(['patch', 'linear.get_issue', '-'], JSON.stringify({ baseRevision: shown.revision, operations: [{ op: 'set-title', title: 'again' }] }))
assert.equal(stale.code, 4); assert.ok(stale.err.includes('read it again') || stale.out.includes('read it again'))
assert.equal(cli(['patch', 'linear.get_issue', '-'], '{"baseRevision":1,"operations":[]}').code, 1)
assert.ok(cli(['explain', 'linear.get_issue']).out.includes('Declared by')); assert.ok(cli(['history', 'linear.get_issue']).out.includes('agent'))
console.log('adaptiveEvolveSmoke: ok')
process.exit(0)
