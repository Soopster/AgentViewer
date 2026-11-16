/** @jsxImportSource @opentui/react */
// The Skill picker: type-to-search with j/k typeable, native insert, the attach/install choice
// for a skill the provider does not load, and the install preview → apply round trip.
import React from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/skill-picker/tui'
import type { SkillsSnapshot } from '../../lib/plugins/skillsManager'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const root = (id: string, p: string, scope: 'user' | 'project', consumers: string[]) => ({ id, path: p, label: id, scope, consumers, exists: true, writable: true })
const skill = (id: string, rootId: string, key: string, description: string) => ({ id, rootId, key, name: key, description, hash: id, files: [{ path: 'SKILL.md', bytes: 1, hash: 'h', mode: 0o644 }], linked: false, syncable: true, issues: [] })
const snapshot: SkillsSnapshot = {
  roots: [root('cl', '/p/.claude/skills', 'project', ['Claude (claude)']), root('lib', '/lib', 'user', ['Library (copy source; not loaded by providers)'])],
  skills: [skill('1', 'cl', 'pdf', 'Read and fill PDF forms'), skill('2', 'cl', 'jira', 'Triage tickets'), skill('3', 'lib', 'chief-of-staff', 'Triage requests and delegate')],
  diagnostics: [], receipts: [],
}
const inserted: string[] = []
const calls: string[] = []
const services = {
  repository: { cwd: '/p', sessionId: 's' },
  session: { session: { provider: 'claude', sessionId: 'sess-1' } },
  'skills-manager': {
    scan: async () => snapshot,
    file: async (_c: string, id: string) => ({ text: `---\nname: x\n---\nBody of skill ${id}`, binary: false, truncated: false }),
    preview: async (_c: string, request: { sourceId: string; targetIds: string[] }) => { calls.push(`preview:${request.sourceId}->${request.targetIds[0]}`); return { id: 'pv', sourceId: request.sourceId, sourceHash: 'h', sourceName: 'chief-of-staff', targets: [{ rootId: 'cl', path: '/p/.claude/skills/chief-of-staff', status: 'add', hash: null, files: [{ path: 'SKILL.md', status: 'add' }] }] } },
    apply: async (_c: string, request: { previewId: string }) => { calls.push(`apply:${request.previewId}`); return { id: 'r', status: 'applied', sourceName: 'x', results: [], createdAt: 0 } },
  },
  composer: { insertText: (text: string) => { inserted.push(text) }, readDraft: () => '', liveCommands: () => [{ command: '/help', description: 'built in', builtin: true }, { command: '/ship-it', description: 'Deploy to production' }] },
  notices: { show: () => {} },
}
let keys: (key: any) => boolean | void = () => false
let closed = 0
const closedCount = (): number => closed
const View = module.views['skill-picker'] as any
const size = { width: 120, height: 36 }
const t = await testRender(
  <View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} />,
  size,
)
const press = async (name: string, sequence = name, ctrl = false) => { await act(async () => { keys({ name, sequence, ctrl, shift: false, meta: false }); await new Promise(r => setTimeout(r, 40)) }); await t.flush?.() }
const type = async (text: string) => { for (const char of text) await press(char, char) }
const frame = async () => { await act(async () => { await new Promise(r => setTimeout(r, 80)) }); await t.renderOnce(); return t.captureCharFrame() }

let screen = await frame()
assert(screen.includes('4 found') && screen.includes('PROJECT') && screen.includes('USER'), 'skills are grouped by where they live')
assert(screen.includes('●') && screen.includes('○'), 'each skill says whether this provider loads it')
assert(screen.includes('Body of skill'), 'the highlighted skill previews its SKILL.md without front matter')
assert(!screen.includes('name: x'), 'front matter is not shown')

// Letters, j and k included, are typed into the search.
await type('jira')
screen = await frame()
assert(screen.includes('› jira') && !screen.includes('chief-of-staff'), 'typing filters the list, j and k included')
await press('return')
assert(inserted.join('') === '/jira ' && closedCount() === 1, 'a skill the provider loads is inserted as its own slash command, then the picker closes')

// A skill claude does not load: choose attach.
closed = 0
const second = await testRender(
  <View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} />,
  size,
)
const t2 = second
const press2 = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false, meta: false }); await new Promise(r => setTimeout(r, 40)) }); await t2.flush?.() }
await act(async () => { await new Promise(r => setTimeout(r, 80)) })
for (const char of 'chief') await press2(char, char)
await press2('return')
await act(async () => { await new Promise(r => setTimeout(r, 40)) }); await t2.renderOnce()
screen = t2.captureCharFrame()
assert(screen.includes('does not load "chief-of-staff"') && screen.includes('a attach') && screen.includes('i install'), 'an unavailable skill offers attach and install, not a silent insert')
assert(inserted.length === 1, 'nothing is inserted before the choice')
await press2('i')
await act(async () => { await new Promise(r => setTimeout(r, 60)) }); await t2.renderOnce()
screen = t2.captureCharFrame()
assert(screen.includes('Install 1 file(s)') && calls.includes('preview:3->cl'), 'install previews into the provider\'s own project root first')
await press2('y')
await act(async () => { await new Promise(r => setTimeout(r, 60)) })
assert(calls.includes('apply:pv'), 'y applies the previewed install')
await press2('escape'); await press2('escape')
await press2('chief'.slice(0, 1), 'c')
await press2('return')
await press2('a')
assert(inserted.at(-1) === '@/lib/chief-of-staff/SKILL.md ', 'attach adds the skill\'s SKILL.md as a file mention')

// Live non-builtin commands reach the picker (a built-in is not a skill).
const third = await testRender(
  <View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} />,
  size,
)
await act(async () => { await new Promise(r => setTimeout(r, 80)) }); await third.renderOnce()
screen = third.captureCharFrame()
assert(screen.includes('COMMANDS') && screen.includes('ship-it'), 'a live non-builtin command is listed under COMMANDS')
assert(!screen.includes('help'), 'a built-in command is not a skill')
await act(async () => {
  t.renderer.destroy?.()
  t2.renderer.destroy?.()
  third.renderer.destroy?.()
})

// /skill <words> opens the picker already searching.
const { seedSkillQuery } = await import('../../plugins/skill-picker/seed')
seedSkillQuery('jira')
const fourth = await testRender(
  <View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} />,
  size,
)
await act(async () => { await new Promise(r => setTimeout(r, 80)) }); await fourth.renderOnce()
screen = fourth.captureCharFrame()
assert(screen.includes('› jira') && !screen.includes('pdf'), '/skill jira starts with the search filled in')
fourth.renderer.destroy?.()

// A skill added by the picker shows as a chip, and clicking × takes it and its text back out.
const { composer: chipModule } = await import('../../plugins/skill-picker/tui/composer')
const { skillChipsFor, addSkillChip: addChip } = await import('../../plugins/skill-picker/chips')
assert(skillChipsFor('sess-1').some(chip => chip.text === '/jira'), 'inserting a skill records a chip for this session')
addChip('sess-1', 'pdf', '/pdf ')
const Chips = chipModule.accessories['skill-chips'] as any
let reported: any = null
const staged: Array<[string, string]> = []
const draft = 'please /jira and /pdf now'
const chipsRender = await testRender(
  <Chips session={{ sessionId: 'sess-1', provider: 'claude' }} draft={draft} visible disabled={false} theme={DARK_THEME} width={80} marginLeft={0}
    report={(p: any) => { reported = p }} services={{ composer: { sendDraft() {}, stageDraft: (text: string, original: string) => { staged.push([text, original]) } } }} />,
  { width: 80, height: 4 },
)
await act(async () => { await new Promise(r => setTimeout(r, 60)) }); await chipsRender.renderOnce()
screen = chipsRender.captureCharFrame()
assert(screen.includes('✦ jira') && screen.includes('✦ pdf'), 'each skill in the draft is a chip')
assert(reported?.rows === 1, 'the accessory reports one row while there are chips')
const row = screen.split('\n').findIndex(line => line.includes('✦ jira'))
const col = screen.split('\n')[row].indexOf('×')
await act(async () => { await chipsRender.mockMouse.click(col, row); await new Promise(r => setTimeout(r, 60)) })
assert(staged.length === 1 && staged[0][0] === 'please and /pdf now' && staged[0][1] === draft, 'clicking × stages the draft without that skill')
assert(!skillChipsFor('sess-1').some(chip => chip.text === '/jira'), 'the chip is gone')
chipsRender.renderer.destroy?.()
console.log('skillPickerSmoke ok')
process.exit(0)
