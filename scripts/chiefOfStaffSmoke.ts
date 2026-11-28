import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const data = mkdtempSync(path.join(tmpdir(), 'cos-data-'))
const repo = mkdtempSync(path.join(tmpdir(), 'cos-repo-'))
process.env.AGENT_VIEWER_COS_DIR = data
process.env.AGENT_VIEWER_SCHEDULES_DIR = data

const { parseRules, validateRules, formatRoutingTable } = await import('../lib/chiefOfStaff/rules')
const { setCosEntry, cosEntryForSession, readCosEntries } = await import('../lib/chiefOfStaff/store')
const { installChiefOfStaffAssets, COS_SKILL_TEXT } = await import('../lib/chiefOfStaff/assets')
const { digestBoard, formatBoardDigest } = await import('../lib/chiefOfStaff/board')
const { readValidatedRules, rulesFileFor, saveChiefOfStaffRules, readChiefOfStaff } = await import('../lib/chiefOfStaff/service')
const { setCosReport } = await import('../lib/chiefOfStaff/store')
const { formatRuleLine, parseRuleLine, reportLines, REPORT_MAX_LINES } = await import('../plugins/chief-of-staff/model')
const { behavior } = await import('../plugins/chief-of-staff/server')
const { manifest } = await import('../plugins/chief-of-staff/manifest')
const { syncDeclaredSchedules } = await import('../lib/schedules/declared')
const { readScheduleState } = await import('../lib/schedules/store')
const { runUnattendedPluginCommand } = await import('../lib/schedules/pluginCommands')

// Rules: problems are reported, never dropped silently.
assert.deepEqual(parseRules(null), { rules: [], problems: [] }, 'no file is no rules and no problem')
assert.match(parseRules('{nope').problems[0].message, /not valid JSON/)
assert.match(parseRules('{"a":1}').problems[0].message, /"rules" array/)
const parsed = parseRules(`{
  // frontend work
  "rules": [
    { "match": "frontend", "provider": "claude", "model": "opus", "effort": "high", },
    { "provider": "codex" },
    { "match": "db", "provider": "mystery" },
    { "match": "infra", "provider": "codex", "worktree": false }
  ]
}`)
assert.equal(parsed.rules.length, 2, 'comments and trailing commas are tolerated; bad rules are left out')
assert.deepEqual(parsed.problems.map(problem => problem.rule), [2, 3], 'each bad rule is named by its position in the file')
const checked = await validateRules(parsed.rules, repo, async (_provider, _cwd, model) => { if (model === 'opus') throw new Error('Model opus is not advertised by claude') })
assert.deepEqual(checked.valid.map(rule => rule.match), ['infra'], 'a rule naming an unadvertised model is rejected')
assert.match(checked.problems[0].message, /not advertised/)
assert.equal(checked.problems[0].rule, 1, 'a rejected rule keeps its file position even after the bad ones before it were dropped')
const table = formatRoutingTable(checked.valid, [...parsed.problems, ...checked.problems])
assert.match(table, /infra → codex, no worktree/)
assert.match(table, /NOT applied/)
assert.match(formatRoutingTable([], []), /no routing rules/)

// The rules file is validated once per content, not per turn.
mkdirSync(path.join(repo, '.agent-viewer'), { recursive: true })
writeFileSync(rulesFileFor(repo), '{"rules":[{"match":"x","provider":"codex"}]}')
let checks = 0
const counting = async () => { checks += 1 }
await readValidatedRules(repo, counting, 1000)
await readValidatedRules(repo, counting, 2000)
assert.equal(checks, 1, 'an unchanged file is not re-validated each turn')
writeFileSync(rulesFileFor(repo), '{"rules":[{"match":"y","provider":"codex"}]}')
await readValidatedRules(repo, counting, 3000)
assert.equal(checks, 2, 'an edited file is')

// Assets: shipped once, never over the user's edits.
const first = await installChiefOfStaffAssets(repo)
assert.deepEqual(first, { skill: true, role: true })
const skillFile = path.join(repo, '.agents/skills/chief-of-staff/SKILL.md')
assert.equal(readFileSync(skillFile, 'utf-8'), COS_SKILL_TEXT)
assert.equal(JSON.parse(readFileSync(path.join(repo, '.agent-viewer/roles/chief-of-staff.json'), 'utf-8')).name, 'Chief of Staff')
writeFileSync(skillFile, 'my edits')
assert.deepEqual(await installChiefOfStaffAssets(repo), { skill: false, role: false })
assert.equal(readFileSync(skillFile, 'utf-8'), 'my edits', 'a second start keeps the user\'s edits')

// Store: one chat per repo, found by session.
setCosEntry(repo, { sessionId: 'cos-1', provider: 'claude', cwd: repo, createdAt: 1 })
assert.equal(cosEntryForSession('cos-1')?.repoRoot, repo)
assert.equal(cosEntryForSession('other'), null)

// Board digest is bounded and says what needs a person.
const task = (id: string, title: string, status: string, owner?: string) => ({ id, title, status, ownerAgentId: owner })
const board = digestBoard({
  run: {} as never,
  agents: [{ id: 'a1', name: 'frontend', role: 'teammate', provider: 'codex', status: 'blocked' }, { id: 'lead', name: 'lead', role: 'lead', provider: 'claude', status: 'working' }] as never,
  tasks: [task('t1', 'Build form', 'in_progress', 'a1'), task('t2', 'Migrate db', 'blocked'), task('t3', 'Old', 'completed'), ...Array.from({ length: 20 }, (_, i) => task(`p${i}`, `P${i}`, 'pending'))] as never,
  locks: [], messages: [], events: [],
})
assert.equal(board.workstreams.length, 12, 'listed workstreams are capped')
assert.ok(board.needsYou.some(line => /Migrate db is blocked/.test(line)) && board.needsYou.includes('frontend is blocked'))
assert.match(board.summary, /more not listed/)
assert.match(formatBoardDigest(board), /Build form \[in_progress, frontend \(codex\)\]/)
assert.equal(digestBoard(null).workstreams.length, 0)

// Hook scoping: only the Chief of Staff's own session is touched.
const target = (sessionId: string) => ({ provider: 'claude' as const, sessionId })
const signal = new AbortController().signal
const turn = (sessionId: string, message: string) => behavior.beforeTurn!({ target: target(sessionId), signal, body: { message } })
const patched = await turn('cos-1', 'ship the login page') as { action: string; body: { message: string } }
assert.equal(patched.action, 'patch')
assert.match(patched.body.message, /^ship the login page\n\n<chief_of_staff_context>/)
assert.match(patched.body.message, /Routing table/)
assert.equal(await turn('somebody-else', 'ship the login page'), undefined, 'another session\'s turn is untouched')
assert.equal(await turn('cos-1', '/status'), undefined, 'a slash command is left alone')
assert.equal(await turn('cos-1', patched.body.message), undefined, 'context is not stacked on a message that has it')
const ask = (sessionId: string, toolName: string) => behavior.permission!({ target: target(sessionId), signal, request: { kind: 'tool', toolName } })
for (const tool of ['Edit', 'Write', 'MultiEdit', 'apply_patch']) assert.equal((await ask('cos-1', tool) as { decision: string }).decision, 'deny', `${tool} is refused for the Chief of Staff`)
assert.match((await ask('cos-1', 'Edit') as { reason: string }).reason, /coord_delegate/, 'the denial says what to do instead')
assert.equal(await ask('cos-1', 'Read'), undefined, 'reading is not refused')
assert.equal(await ask('cos-1', 'Bash'), undefined)
assert.equal(await ask('somebody-else', 'Edit'), undefined, 'other sessions may edit')
assert.equal(manifest.behavior.permissionMode, 'policy', 'a deny must outrank other plugins\' allows')

// Editor: a rule is one editable line, and saving rewrites the file with what was entered.
assert.equal(formatRuleLine({ match: 'frontend', provider: 'claude', instance: 'work', model: 'opus', effort: 'high' }), 'frontend | claude:work | opus | high')
assert.equal(formatRuleLine({ match: 'db', provider: 'codex', worktree: false }), 'db | codex | no-worktree')
for (const rule of [{ match: 'a b', provider: 'codex', model: 'm', role: 'r' }, { match: 'x', provider: 'pi', instance: 'i', effort: 'low', worktree: false }]) {
  assert.deepEqual(parseRuleLine(formatRuleLine(rule)), { rule }, 'a rule survives being edited as a line')
}
assert.ok('error' in parseRuleLine(' | claude'), 'a line with no match is refused with a hint')
assert.ok('error' in parseRuleLine('frontend'), 'a line with no provider is refused with a hint')
const saved = await saveChiefOfStaffRules(repo, [{ match: 'ui', provider: 'claude' }, { match: 'infra', provider: 'codex', worktree: false }])
assert.deepEqual(saved.ruleList.map(rule => rule.match), ['ui', 'infra'])
assert.deepEqual(JSON.parse(readFileSync(rulesFileFor(repo), 'utf-8')).rules[1], { match: 'infra', provider: 'codex', worktree: false })
await assert.rejects(saveChiefOfStaffRules(repo, [{ match: 'x', provider: 'nope' }]), /unknown provider/, 'a rule nothing can read is never written')
assert.deepEqual((await readChiefOfStaff(repo)).ruleList.map(rule => rule.match), ['ui', 'infra'], 'a refused save leaves the file as it was')

// Latest report: the Chief of Staff's own newest reply, and only its own.
assert.equal((await readChiefOfStaff(repo)).report, null)
const settle = async (sessionId: string, text: string) => behavior.afterTurn!({ target: target(sessionId), signal, followUps: 0, readMessages: async () => [{ type: 'assistant', uuid: 'u', session_id: sessionId, message: { role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null }] as never })
await settle('cos-1', 'Two things need you.\n- Migrate db is blocked')
assert.match((await readChiefOfStaff(repo)).report!.text, /Migrate db is blocked/)
await settle('somebody-else', 'not mine')
assert.doesNotMatch((await readChiefOfStaff(repo)).report!.text, /not mine/, 'another session never becomes the report')
setCosReport('cos-1', '   ')
assert.match((await readChiefOfStaff(repo)).report!.text, /Two things/, 'an empty reply does not replace a report')
const long = reportLines(Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n'))
assert.equal(long.length, REPORT_MAX_LINES + 1)
assert.match(long.at(-1)!.text, /18 more lines in the chat/, 'a long report says it is cut')
assert.ok(manifest.behavior.hooks.includes('afterTurn'))

// Schedules: declared, off, and runnable unattended.
const synced = syncDeclaredSchedules([manifest])
assert.equal(synced.added.length, 3)
assert.ok(readScheduleState().schedules.filter(schedule => schedule.source === 'chief-of-staff').every(schedule => schedule.enabled === false), 'a plugin does not start recurring spend by itself')
assert.equal((await runUnattendedPluginCommand('nope:thing')).outcome, 'failed')
const none = (await import('node:fs')).rmSync
none(path.join(data, 'chief-of-staff.json'))
const idle = await runUnattendedPluginCommand('chief-of-staff:morning')
assert.equal(idle.outcome, 'skipped', 'with no Chief of Staff started the digest is a skip, not a success')
assert.ok(!existsSync(path.join(data, 'chief-of-staff.json')) || Object.keys(readCosEntries()).length === 0)
console.log('chiefOfStaffSmoke ok')
process.exit(0)
