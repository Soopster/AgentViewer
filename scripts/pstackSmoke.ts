// pstack: the vendored library is complete, /pstack expands through the real send-path hook,
// roles are validated and never silently lost, and the skills reach the Skills Manager.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { applyPluginBeforeTurn } from '../lib/plugins/serverBehaviors'
import { listPluginComposerSlashCommands, matchPluginComposerSlashCommand } from '../lib/plugins/composerSlash'
import { listPstackSkills, pstackDir, pstackSkillFile, pstackSkillsDir } from '../lib/pstack/library'
import { formatRoleTable, parseRoleLine, PSTACK_ROLES } from '../lib/pstack/roles'
import { readPstack, savePstackRole, validatePstackRoles } from '../lib/pstack/service'
import { createSkillsManager } from '../lib/skills-manager/service'
import { skillsContext } from '../lib/skills-manager/roots'

const home = mkdtempSync(path.join(tmpdir(), 'pstack-smoke-'))
process.env.AGENT_VIEWER_PSTACK_CONFIG = path.join(home, 'pstack.json')
const check = async (seat: { model?: string }) => { if (seat.model === 'nope') throw new Error('Model nope is not advertised') }
try {
  // Library: every playbook and principle poteto-mode names must be shipped.
  const skills = listPstackSkills()
  for (const name of ['poteto-mode', 'interrogate', 'arena', 'swarm', 'unslop', 'principle-prove-it-works']) assert(skills.includes(name), `ships ${name}`)
  assert(!skills.includes('setup-pstack') && !skills.includes('statechart'), 'excluded skills are not shipped')
  assert(existsSync(path.join(pstackDir(), 'adapter.md')) && existsSync(path.join(pstackDir(), 'vendor', 'LICENSE')), 'adapter and licence ship')
  const poteto = readFileSync(pstackSkillFile('poteto-mode'), 'utf8')
  for (const [, file] of poteto.matchAll(/`(playbooks\/[a-z-]+\.md)`/g)) if (!file!.includes('<')) assert(existsSync(path.join(pstackSkillsDir(), 'poteto-mode', file!)), file)

  // Slash menu lists it, but it is never handled locally: the message must reach the send path.
  for (const renderer of ['web', 'tui'] as const) {
    assert(listPluginComposerSlashCommands(renderer, 'codex').some(item => item.command === '/pstack'), `${renderer} lists /pstack`)
    assert.equal(matchPluginComposerSlashCommand('/pstack fix it', renderer, 'codex'), undefined)
  }

  // Roles.
  assert.deepEqual(parseRoleLine('bug-fix', 'codex gpt-5.4 high'), { seats: [{ provider: 'codex', model: 'gpt-5.4', effort: 'high' }] })
  assert.deepEqual(parseRoleLine('bug-fix', 'claude:work high'), { seats: [{ provider: 'claude', instance: 'work', effort: 'high' }] })
  assert('error' in parseRoleLine('bug-fix', 'claude, codex'), 'a single role refuses a list')
  assert('error' in parseRoleLine('arena runners', 'claude, nope'), 'an unknown provider is refused')
  await savePstackRole(home, 'bug-fix', 'codex gpt-5.4 high', check)
  const saved = await savePstackRole(home, 'arena runners', 'claude opus, codex nope', check)
  assert.equal(saved.roles['bug-fix'], 'codex gpt-5.4 high')
  assert.deepEqual(saved.problems.map(item => item.role), ['arena runners'])
  const table = formatRoleTable(saved.roles, saved.problems)
  assert(table.includes('bug-fix: codex gpt-5.4 high') && !table.includes('arena runners: claude') && table.includes('NOT applied'))
  await assert.rejects(savePstackRole(home, 'bug-fix', 'nope x', check), /unknown provider/)
  assert.equal((await readPstack(home, check)).roles['bug-fix'], 'codex gpt-5.4 high', 'a refused save changes nothing')
  assert.equal((await savePstackRole(home, 'arena runners', '', check)).roles['arena runners'], undefined, 'empty clears')
  assert.equal((await validatePstackRoles({}, home, check)).length, 0)
  writeFileSync(process.env.AGENT_VIEWER_PSTACK_CONFIG, '{ broken')
  await assert.rejects(savePstackRole(home, 'bug-fix', 'codex', check), /Fix/, 'a broken file is never overwritten')
  assert.equal(readFileSync(process.env.AGENT_VIEWER_PSTACK_CONFIG, 'utf8'), '{ broken')
  rmSync(process.env.AGENT_VIEWER_PSTACK_CONFIG)

  // The real hook pipeline. No role is set, so no provider catalog is read.
  const target = { provider: 'codex' as const, sessionId: 'pstack-smoke' }
  const send = (message: string) => applyPluginBeforeTurn({ target, body: { message, cwd: home }, signal: new AbortController().signal })
  const plain = (await send('/pstack fix the scroll drift')).message as string
  assert(plain.startsWith('fix the scroll drift\n\n<pstack_context skill="poteto-mode">'), plain.slice(0, 200))
  for (const file of [`${pstackDir()}/adapter.md`, pstackSkillFile('poteto-mode')]) assert(plain.includes(file) && existsSync(file), file)
  assert(plain.includes('every role runs on your current model') && PSTACK_ROLES.length === 9)
  assert((await send('/pstack /interrogate this branch')).message?.toString().includes('skill="interrogate"'))
  assert.equal((await send('about /pstack in prose')).message, 'about /pstack in prose')
  assert.equal((await send('/pstacked')).message, '/pstacked')
  await assert.rejects(send('/pstack'), /Usage/)
  await assert.rejects(send('/pstack /nothing here'), /no skill "nothing"/)

  // Skills Manager sees the bundle as a read-only library copy source, loaded by no provider.
  const context = await skillsContext()
  const snapshot = await createSkillsManager(async () => ({ ...context, home, environment: {}, instances: [], dataDir: path.join(home, 'data') })).scan(home)
  const root = snapshot.roots.find(item => item.label === 'pstack (bundled)')
  assert(root && !root.writable && root.consumers.every(label => label.includes('not loaded by providers')), JSON.stringify(root))
  assert(snapshot.skills.some(item => item.rootId === root.id && item.name === 'poteto-mode'), 'bundled skills are listed')
  console.log(`pstackSmoke ok (${skills.length} skills)`)
} finally { rmSync(home, { recursive: true, force: true }) }
