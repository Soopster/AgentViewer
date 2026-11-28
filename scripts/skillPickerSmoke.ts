import assert from 'node:assert/strict'
import type { SkillsSnapshot } from '../lib/plugins/skillsManager'
import { composerSkillsFromSnapshot } from '../lib/skillPicker/list'
import { planSkillInsert, nativeSkillText } from '../lib/skillPicker/insert'
import { addSkillChip, draftWithoutSkill, removeSkillChip, skillChipsFor, visibleSkillChips } from '../plugins/skill-picker/chips'
import { seedSkillQuery, subscribeSkillQuery, takeSkillQuery } from '../plugins/skill-picker/seed'
import { groupSkillCommands, markSkillCommands, normalizeSlashCommandSuggestions } from '../lib/slashCommands'
import { matchTier, rankSkills, suggestSkills } from '../lib/skillPicker/rank'

const root = (id: string, path: string, scope: 'user' | 'project', consumers: string[]) => ({ id, path, label: id, scope, consumers, exists: true, writable: true })
const skill = (id: string, rootId: string, key: string, name: string, description: string) => ({ id, rootId, key, name, description, hash: id, files: [{ path: 'SKILL.md', bytes: 1, hash: 'h', mode: 0o644 }], linked: false, syncable: true, issues: [] })
const snapshot: SkillsSnapshot = {
  roots: [
    root('claude-user', '/h/.claude/skills', 'user', ['Claude (claude)']),
    root('claude-proj', '/p/.claude/skills', 'project', ['Claude (claude)']),
    root('shared', '/h/.agents/skills', 'user', ['Shared', 'Codex (codex)']),
    root('library', '/h/.config/agent-viewer/skills', 'user', ['Library (copy source; not loaded by providers)']),
  ],
  skills: [
    skill('1', 'claude-user', 'pdf', 'pdf', 'Read and fill PDF forms'),
    skill('2', 'claude-proj', 'pdf', 'pdf', 'Project PDF rules'),
    skill('3', 'shared', 'deploy', 'deploy', 'Deploy the app to production'),
    skill('4', 'library', 'chief-of-staff', 'chief-of-staff', 'Triage requests into workstreams and delegate'),
  ],
  diagnostics: [], receipts: [],
}
const live = [{ command: '/help', description: 'h', builtin: true }, { command: '/deploy', description: 'Deploy' }, { command: '/review-pr', description: 'Review a pull request' }]

const forClaude = composerSkillsFromSnapshot(snapshot, live, 'claude')
const byName = (list: typeof forClaude, name: string) => list.find(entry => entry.name === name)!
assert.equal(forClaude.filter(entry => entry.name === 'pdf').length, 1, 'one skill in two roots is one entry')
assert.equal(byName(forClaude, 'pdf').source, 'project', 'the project copy wins over the user copy')
assert.equal(byName(forClaude, 'pdf').path, '/p/.claude/skills/pdf/SKILL.md')
for (const [directory, expected] of [
  ['/project/skills/', '/project/skills/nested/pdf/SKILL.md'],
  ['C:\\project\\skills\\', 'C:\\project\\skills\\nested\\pdf\\SKILL.md'],
  ['\\\\server\\share\\skills', '\\\\server\\share\\skills\\nested\\pdf\\SKILL.md'],
]) {
  const entries = composerSkillsFromSnapshot({
    roots: [root('paths', directory, 'project', ['Claude (claude)'])],
    skills: [skill('path', 'paths', 'nested/pdf', 'pdf', '')], diagnostics: [], receipts: [],
  }, [], 'claude')
  assert.equal(entries[0]?.path, expected, 'paths use the inventory filesystem, without Node APIs in the browser')
}
assert.equal(byName(forClaude, 'pdf').nativeForProvider, true, 'a Claude root means Claude loads it')
assert.equal(byName(forClaude, 'deploy').nativeForProvider, true, 'a live command the provider reports means it loads it')
assert.equal(byName(forClaude, 'chief-of-staff').nativeForProvider, false, 'the copy-only library is loaded by nobody')
assert.ok(byName(forClaude, 'review-pr').source === 'command' && byName(forClaude, 'review-pr').files.length === 0, 'a live command with no folder is still listed')
assert.ok(!forClaude.some(entry => entry.name === 'help'), 'builtin commands are not skills')
const forCodex = composerSkillsFromSnapshot(snapshot, [], 'codex')
assert.equal(byName(forCodex, 'deploy').nativeForProvider, true, 'Codex loads the shared root through its own instance')
assert.equal(byName(forCodex, 'pdf').nativeForProvider, false)
assert.equal(composerSkillsFromSnapshot(snapshot, [], 'codex-sandbox').filter(entry => entry.nativeForProvider).length, 0, 'provider names match whole ids, not prefixes of words')

// Ranking: quality first, frecency only breaks ties, a never-used skill is still found.
const names = ['deploy', 'deploy-preview', 'undeploy', 'pdf'].map(name => ({ ...byName(forClaude, 'pdf'), key: name, name, description: '' }))
assert.deepEqual(rankSkills(names, 'deploy').map(entry => entry.name), ['deploy', 'deploy-preview', 'undeploy'], 'exact, prefix, then substring')
assert.deepEqual(rankSkills(names, 'deploy', entry => (entry.name === 'undeploy' ? 99 : 0)).map(entry => entry.name), ['deploy', 'deploy-preview', 'undeploy'], 'frecency never outranks a better match')
assert.deepEqual(rankSkills(names.slice(0, 2), 'dep', entry => (entry.name === 'deploy-preview' ? 5 : 0)).map(entry => entry.name), ['deploy-preview', 'deploy'], 'frecency breaks a tie')
assert.equal(matchTier(byName(forClaude, 'chief-of-staff'), 'cos'), 2, 'a subsequence still finds it')
assert.equal(matchTier(byName(forClaude, 'chief-of-staff'), 'workstreams'), 3, 'the description is searched')
assert.equal(matchTier(byName(forClaude, 'chief-of-staff'), 'zzz'), 0)
assert.equal(rankSkills(forClaude, '').length, forClaude.length, 'no query lists everything')

// Suggestions: vocabulary overlap, nothing from a thin draft or a lone common word.
assert.equal(suggestSkills(forClaude, 'please fill in this PDF form for me')[0]?.name, 'pdf')
assert.equal(suggestSkills(forClaude, 'deploy to production now')[0]?.name, 'deploy')
assert.deepEqual(suggestSkills(forClaude, 'hello'), [], 'one word is not a signal')
assert.deepEqual(suggestSkills(forClaude, 'tidy the kitchen and the garden'), [])

// Insert: native syntax per provider; otherwise attach or install.
assert.deepEqual(planSkillInsert(byName(forClaude, 'deploy'), 'claude'), { kind: 'native', text: '/deploy ' })
assert.equal(nativeSkillText('codex', 'deploy'), '$deploy ')
assert.equal(nativeSkillText('pi', 'deploy'), '/skill:deploy ')
assert.equal(nativeSkillText('opencode', 'deploy'), 'Use the "deploy" skill. ')
const plan = planSkillInsert(byName(forClaude, 'chief-of-staff'), 'claude')
assert.equal(plan.kind, 'unavailable')
assert.deepEqual(plan.kind === 'unavailable' && plan.attach, { type: 'file', path: '/h/.config/agent-viewer/skills/chief-of-staff/SKILL.md', displayName: 'skill: chief-of-staff' })
assert.ok(plan.kind === 'unavailable' && plan.canInstall, 'a skill with a Skills Manager id can be installed')
const commandOnly = planSkillInsert({ ...byName(forClaude, 'review-pr'), nativeForProvider: false }, 'pi')
assert.deepEqual(commandOnly, { kind: 'unavailable', attach: null, canInstall: false }, 'a command with no file offers neither')

// Chips: a label for text in the draft, shown only while that text is there.
addSkillChip('s1', 'deploy', '/deploy ')
addSkillChip('s1', 'deploy', '/deploy ')
addSkillChip('s2', 'other', '$other ')
assert.equal(skillChipsFor('s1').length, 1, 'the same text is one chip')
assert.equal(skillChipsFor('s2').length, 1, 'chips are per session')
assert.deepEqual(visibleSkillChips(skillChipsFor('s1'), 'fix it').map(c => c.name), [], 'text gone from the draft hides the chip')
assert.deepEqual(visibleSkillChips(skillChipsFor('s1'), 'please /deploy now').map(c => c.name), ['deploy'])
assert.equal(draftWithoutSkill('please /deploy now', '/deploy'), 'please now')
assert.equal(draftWithoutSkill('/deploy now', '/deploy'), 'now')
assert.equal(draftWithoutSkill('now /deploy', '/deploy'), 'now')
assert.equal(draftWithoutSkill('/deploy', '/deploy'), '')
assert.equal(draftWithoutSkill('nothing here', '/deploy'), 'nothing here')
removeSkillChip('s1', skillChipsFor('s1')[0].id)
assert.equal(skillChipsFor('s1').length, 0)

// /skill <words> seeds the picker once, and tells one that is already open.
assert.equal(takeSkillQuery(), null)
let told = 0
seedSkillQuery('  review pr ')
assert.equal(takeSkillQuery(), 'review pr')
assert.equal(takeSkillQuery(), null, 'taken once')
let heard = ''
const stop = subscribeSkillQuery(query => { told += 1; heard = query })
let alsoHeard = ''
const stopSecond = subscribeSkillQuery(query => { alsoHeard = query })
seedSkillQuery(' deploy ')
assert.equal(told, 1)
assert.equal(heard, 'deploy', 'an open picker is told the words')
assert.equal(alsoHeard, 'deploy', 'each mounted picker receives the query without consuming it from another')
assert.equal(takeSkillQuery(), null, 'and nothing is left waiting')
seedSkillQuery('  ')
assert.equal(told, 1, 'an empty argument seeds nothing')
stop()
stopSecond()
seedSkillQuery('pdf')
assert.equal(takeSkillQuery(), 'pdf', 'after all pickers close the next query waits for a new picker')
assert.equal(told, 1, 'unsubscribed pickers receive no further queries')

// The menu's Skills section: only where the provider flags its built-ins, never a name the catalog lists.
const menuBaseline = [{ command: '/help', description: '' }, { command: '/review', description: '' }]
const liveMenu = [{ command: '/help', description: '', builtin: true }, { command: '/review', description: '' }, { command: '/deploy', description: 'ship it' }]
assert.deepEqual(markSkillCommands(liveMenu, menuBaseline).map(c => c.section ?? '-'), ['-', '-', 'skills'])
assert.deepEqual(markSkillCommands([{ command: '/x', description: '' }], menuBaseline).map(c => c.section ?? '-'), ['-'], 'an unflagged provider has no skills to name')
const mixed = [{ command: '/deploy', description: '', section: 'skills' as const }, { command: '/help', description: '' }]
assert.deepEqual(groupSkillCommands(mixed, '').map(c => c.command), ['/help', '/deploy'], 'browsing gathers skills last')
assert.deepEqual(groupSkillCommands(mixed, 'dep').map(c => c.command), ['/deploy', '/help'], 'a query keeps its ranking')
assert.equal(normalizeSlashCommandSuggestions([{ command: 'a', builtin: true }, { command: 'b' }])?.map(c => c.builtin ?? false).join(), 'true,false', 'the built-in flag survives')
console.log('skillPickerSmoke ok')
