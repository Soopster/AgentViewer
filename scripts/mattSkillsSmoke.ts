// Matt Pocock's skills: the vendored pack is complete, /matt expands through the real send-path hook,
// repository setup is read from the checkout root, and the skills reach the Skills Manager.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { applyPluginBeforeTurn } from '../lib/plugins/serverBehaviors'
import { listPluginComposerSlashCommands, matchPluginComposerSlashCommand } from '../lib/plugins/composerSlash'
import { MATT_DEFAULT_SKILL, MATT_SETUP_SKILL } from '../lib/mattSkills/command'
import { mattLibrary, readMattSkills } from '../lib/mattSkills/service'
import { MATT_PACK } from '../lib/mattSkills/playbooks'
import { createSkillsManager } from '../lib/skills-manager/service'
import { skillsContext } from '../lib/skills-manager/roots'

const home = mkdtempSync(path.join(tmpdir(), 'matt-skills-smoke-'))
try {
  const skills = mattLibrary.list()
  assert.equal(skills.length, 27)
  for (const name of [MATT_DEFAULT_SKILL, MATT_SETUP_SKILL, 'grilling', 'tdd', 'code-review']) assert(skills.includes(name), `ships ${name}`)
  assert(existsSync(path.join(mattLibrary.dir(), 'adapter.md')) && existsSync(path.join(mattLibrary.libraryDir(), 'LICENSE')), 'adapter and licence ship')
  // Every skill another skill tells the agent to call, and every file it links, must be shipped.
  for (const name of skills) {
    const dir = path.dirname(mattLibrary.skillFile(name))
    for (const file of readdirSync(dir).filter(item => item.endsWith('.md'))) {
      const text = readFileSync(path.join(dir, file), 'utf8')
      for (const line of text.split('\n').filter(item => /Skill tool/.test(item))) {
        for (const [, called] of line.matchAll(/["`]([a-z]+(?:-[a-z]+)*)["`]/g)) assert(skills.includes(called!), `${name} calls ${called}`)
      }
      // Skill files link siblings; the format docs also show example links that exist only in a user's repo.
      if (file === 'SKILL.md') for (const [, target] of text.matchAll(/\]\((?:\.\/)?([A-Za-z0-9_-]+\.(?:md|sh))\)/g)) assert(existsSync(path.join(dir, target!)), `${name} links ${target}`)
    }
  }
  assert.equal(MATT_PACK.playbooks[0]!.phases.length, 2)

  for (const renderer of ['web', 'tui'] as const) {
    assert(listPluginComposerSlashCommands(renderer, 'pi').some(item => item.command === '/matt'), `${renderer} lists /matt`)
    assert.equal(matchPluginComposerSlashCommand('/matt fix it', renderer, 'pi'), undefined, 'never handled locally')
  }

  // Setup is the checkout's, also from a subdirectory.
  const repo = path.join(home, 'repo'), nested = path.join(repo, 'a', 'b')
  mkdirSync(path.join(repo, '.git'), { recursive: true })
  mkdirSync(nested, { recursive: true })
  const before = await readMattSkills(nested)
  assert(before.version !== 'missing' && !before.setup.configured && before.setup.root === repo)
  assert(before.skills.every(skill => skill.description && !/^["']/.test(skill.description)), 'every description is read')
  assert(before.skills.find(skill => skill.name === 'grill-me')!.userInvoked)
  assert(!before.skills.find(skill => skill.name === 'tdd')!.userInvoked)

  const send = (message: string) => applyPluginBeforeTurn({ target: { provider: 'pi' as const, sessionId: 'matt-smoke' }, body: { message, cwd: nested }, signal: new AbortController().signal })
  const routed = (await send('/matt I have a vague feature idea')).message as string
  assert(routed.startsWith('I have a vague feature idea\n\n<matt_skills_context skill="ask-matt">'), routed.slice(0, 200))
  for (const file of [`${mattLibrary.dir()}/adapter.md`, mattLibrary.skillFile('ask-matt')]) assert(routed.includes(file) && existsSync(file), file)
  assert(routed.includes('Repository setup: not run'))
  mkdirSync(path.join(repo, 'docs', 'agents'), { recursive: true })
  writeFileSync(path.join(repo, 'docs', 'agents', 'issue-tracker.md'), '# tracker\n')
  const named = (await send('/matt /tdd the parser')).message as string
  assert(named.includes('skill="tdd"') && named.includes('Repository setup: done'))
  assert.equal((await send('see /matt in prose')).message, 'see /matt in prose')
  assert.equal((await send('/mattress')).message, '/mattress')
  await assert.rejects(send('/matt'), /Usage/)
  await assert.rejects(send('/matt /nothing here'), /no skill "nothing"/)
  // The two packs' commands do not claim each other's messages.
  assert(!(await send('/pstack fix it')).message!.toString().includes('matt_skills_context'))
  assert(!named.includes('pstack_context'))

  const context = await skillsContext()
  const snapshot = await createSkillsManager(async () => ({ ...context, home, environment: {}, instances: [], dataDir: path.join(home, 'data') })).scan(repo)
  const root = snapshot.roots.find(item => item.label === 'Matt Pocock skills (bundled)')
  assert(root && !root.writable && root.consumers.every(label => label.includes('not loaded by providers')), JSON.stringify(root))
  assert.equal(snapshot.skills.filter(item => item.rootId === root.id).length, 27)
  console.log(`mattSkillsSmoke ok (${skills.length} skills)`)
} finally { rmSync(home, { recursive: true, force: true }) }
