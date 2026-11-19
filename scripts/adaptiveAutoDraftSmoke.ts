// Automatic drafting is opt-in, drafts only, bounded per day, one at a time, and it leaves a failing tool alone.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-auto-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes'); process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state'); process.env.AGENT_VIEWER_PLUGIN_SETTINGS = join(root, 'plugins.json')
process.chdir(root)
const { recordShape, autoDraftOnce, setAutoDraft, setAutoDraftAsk, adaptiveUiSnapshot, nativeAdaptiveUi, AUTO_DRAFT_AFTER, AUTO_DRAFT_DAILY } = await import('../lib/adaptiveUi/runtime')
const { loadCardRules, writeCardRule } = await import('../lib/adaptiveUi/store')
const { readCardHistory } = await import('../lib/adaptiveUi/history')

const sample = { input: { q: 'x' }, result: { text: '{"hits":[1]}', isError: false } }
const seen = (tool: string, times: number, withSample = true) => { for (let i = 0; i < times; i++) recordShape({ tool, inputKeys: ['q'], ...(withSample && i === 0 ? { sample } : {}) }) }
const calls: string[] = []
const ask = async ({ prompt }: { prompt: string }) => { const tool = /for the tool "([^"]+)"/.exec(prompt)![1]!; calls.push(tool); return JSON.stringify({ status: 'active', overridesNative: true, match: { tool: 'Bash' }, title: `card for ${tool}`, blocks: [] }) }

setAutoDraftAsk(ask, false) // explicit calls only for now; and the unprompted path must never reach a real model in a smoke
// Off by default: however often a tool is seen, nothing is drafted.
seen('mcp__a__one', AUTO_DRAFT_AFTER + 3)
assert.equal(await autoDraftOnce(ask), null); assert.equal(calls.length, 0); assert.equal(adaptiveUiSnapshot().settings.autoDraft, false)

// On: only a tool seen often enough, with a sample, qualifies. What it makes is a draft for THAT tool.
setAutoDraft(true); calls.length = 0
seen('mcp__a__rare', AUTO_DRAFT_AFTER - 2); seen('mcp__a__nosample', AUTO_DRAFT_AFTER + 1, false)
assert.equal(await autoDraftOnce(ask), 'a.one', 'drafts the busy tool')
const rule = loadCardRules().rules.find(entry => entry.id === 'a.one')!
assert.equal(rule.status, 'draft', 'never activated'); assert.equal(rule.match.tool, 'mcp__a__one'); assert.equal(rule.overridesNative, undefined, 'a reply cannot ask to replace a built-in card')
assert.deepEqual(readCardHistory(loadCardRules().dir, { id: 'a.one' }).map(entry => `${entry.actor}:${entry.action}`), ['model:design'])
assert.ok(!calls.includes('mcp__a__rare') && !calls.includes('mcp__a__nosample'), 'too few calls, or nothing to design from, is left alone')
assert.equal(await autoDraftOnce(ask), null, 'a tool with a card is not drafted again'); assert.equal(calls.length, 1)

// A tool that is dismissed, or already has a card of the person's own, is left alone.
seen('mcp__b__mine', AUTO_DRAFT_AFTER + 1); writeCardRule({ id: 'mine', status: 'active', match: { tool: 'mcp__b__mine' }, title: 't', blocks: [] })
seen('mcp__b__no', AUTO_DRAFT_AFTER + 1); await nativeAdaptiveUi.dismissShape('mcp__b__no|q', true)
calls.length = 0; assert.equal(await autoDraftOnce(ask), null); assert.equal(calls.length, 0)

// A failing tool is not retried on every call, and a failure does not use up the day.
seen('mcp__c__bad', AUTO_DRAFT_AFTER + 1)
let attempts = 0
const failing = async () => { attempts++; throw new Error('quota') }
const t0 = new Date('2026-03-01T10:00:00Z')
assert.equal(await autoDraftOnce(failing, t0), null); assert.equal(attempts, 1)
assert.equal(await autoDraftOnce(failing, new Date(t0.getTime() + 10 * 60_000)), null); assert.equal(attempts, 1, 'cooling down')
assert.equal(await autoDraftOnce(failing, new Date(t0.getTime() + 61 * 60_000)), null); assert.equal(attempts, 2, 'tried again after an hour')

// A daily ceiling, one at a time, then a new day.
for (let i = 0; i < 6; i++) seen(`mcp__d__t${i}`, AUTO_DRAFT_AFTER + 1)
const day = new Date('2026-03-02T09:00:00Z'); calls.length = 0
const [first, second] = await Promise.all([autoDraftOnce(ask, day), autoDraftOnce(ask, day)])
assert.ok((first === null) !== (second === null), 'two callers at once make one draft')
let made = 1; for (let i = 0; i < 10; i++) if (await autoDraftOnce(ask, day)) made++
assert.equal(made, AUTO_DRAFT_DAILY, `at most ${AUTO_DRAFT_DAILY} a day`)
assert.ok(await autoDraftOnce(ask, new Date(day.getTime() + 24 * 3_600_000)), 'a new day, a new allowance')

// Unprompted: with the background path on, simply seeing a tool often enough drafts it, with no explicit call.
setAutoDraftAsk(ask, true); calls.length = 0
seen('mcp__e__live', 60) // the busiest, so it is the one picked
// (The first trigger fires while the tool is still below the threshold and drafts whatever else qualifies; the next
// sighting, once that has finished, picks the busiest remaining one.)
for (let attempt = 0; attempt < 6 && !loadCardRules().rules.some(entry => entry.match.tool === 'mcp__e__live'); attempt++) { await new Promise(resolve => setTimeout(resolve, 80)); seen('mcp__e__live', 1, false) }
assert.ok(loadCardRules().rules.some(entry => entry.match.tool === 'mcp__e__live' && entry.status === 'draft'), 'seeing a tool often enough is all it takes, and the result is a draft')
setAutoDraftAsk(ask, false)

// Off again, and the choice survives: it is stored with the rest of the state.
setAutoDraft(false); assert.equal(await autoDraftOnce(ask, new Date('2026-03-09T00:00:00Z')), null)
setAutoDraft(true); await new Promise(resolve => setTimeout(resolve, 2300))
assert.equal(JSON.parse(readFileSync(join(root, 'state', 'state.json'), 'utf8')).autoDraft, true)
console.log('adaptiveAutoDraftSmoke: ok')
process.exit(0)
