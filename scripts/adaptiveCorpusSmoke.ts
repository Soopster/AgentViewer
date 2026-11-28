// What past transcripts teach: field presence, enum values and list lengths from real results; bounded, private,
// incremental, and usable to check a rule against history.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-corpus-'))
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
const { CORPUS_LIMITS, corpusProfileText, corpusSummary, emptyCorpus, ingestCall, loadCorpus, profileCoverage, pruneEnums, scanHistory } = await import('../lib/adaptiveUi/corpus')
const { parseCardRule } = await import('../lib/plugins/cardTemplates')

const TOOL = 'mcp__linear__get_issue'
const result = (o: unknown) => ({ text: JSON.stringify(o), isError: false })
const corpus = emptyCorpus()
const states = ['completed', 'completed', 'completed', 'completed', 'failed', 'blocked', 'completed', 'completed', 'completed', 'completed']
states.forEach((state, i) => ingestCall(corpus, { tool: TOOL, at: 1000 + i, input: { id: `ENG-${i}`, ...(i % 2 ? { verbose: true } : {}) }, result: result({ task: { id: `t${i}`, status: state, owner: { name: 'Ada', token: 'SECRET-TOKEN' }, files: Array.from({ length: i % 4 }, (_, n) => ({ path: `f${n}` })) }, ...(i === 3 ? { diff: 'only here' } : {}), apiKey: 'SECRET-KEY' }) }))
ingestCall(corpus, { tool: TOOL, at: 2000, input: { id: 'x' }, result: { text: 'Error: not found', isError: true } })
const t = corpus.tools[TOOL]!
assert.equal(t.calls, 11); assert.equal(t.errors, 1); assert.equal(t.jsonResults, 10); assert.equal(t.withResult, 11); assert.equal(t.mcpServer, 'linear')
assert.equal(t.fields['result.json.task.status']!.present, 10)
assert.deepEqual(t.fields['result.json.task.status']!.values, { completed: 8, failed: 1, blocked: 1 }, 'an enum-like field keeps its real values')
assert.equal(t.fields['result.json.diff']!.present, 1); assert.equal(t.fields['result.json.task.files']!.arrayMax, 3); assert.equal(t.fields['result.json.task.files']!.arrayMin, 0)
assert.equal(t.fields['result.json.task.files[].path']!.present, 7, 'an item field counts the results it appeared in, once each (not once per item)'); assert.ok(t.fields['result.json.task.files[].path']!.count > 7)
assert.equal(Object.keys(t.fields['result.json.task.id']!.values!).length, 10); pruneEnums(corpus)
assert.equal(t.fields['result.json.task.id']!.values, null, 'a field that is distinct per call keeps no value list (ids are not enums)')
assert.ok(t.fields['result.json.task.status']!.values, 'a field whose values repeat keeps them')
assert.deepEqual(t.keySets, { id: 6, 'id,verbose': 5 }); assert.equal(t.fields['input.verbose']!.present, 5)
// Privacy: secret-looking fields are never recorded, anywhere.
assert.ok(!JSON.stringify(corpus).includes('SECRET'), 'no secret value is kept'); assert.equal(t.fields['result.json.apiKey'], undefined); assert.equal(t.fields['result.json.task.owner.token'], undefined)
// Samples: a few representative ones, an error among them.
assert.ok(t.samples.length > 0 && t.samples.length <= CORPUS_LIMITS.samples); assert.ok(t.samples.some(sample => sample.result?.isError), 'the failure is kept as a sample')
// Built-in tools are not tracked.
ingestCall(corpus, { tool: 'Bash', at: 1, input: { command: 'ls' }, result: { text: 'x', isError: false } }); assert.equal(corpus.tools.Bash, undefined)

// The profile a designer reads.
t.sessions = 3
const profile = corpusProfileText(t)
assert.ok(profile.includes('11 past calls in 3 sessions') && profile.includes('9% failed') && profile.includes('JSON 91%'), profile)
assert.ok(profile.includes('result.json.task.status  100%  string one of: completed (80%), failed (10%), blocked (10%)'), profile)
assert.ok(profile.includes('result.json.diff  10%') && profile.includes('result.json.task.files  100%  array 0–3 items') && profile.includes('result.json.task.files[].path  70%'), profile)
assert.ok(!/\d{3,}%/.test(profile.replace(/100%/g, '')), 'no share is over 100%'); assert.ok(!profile.includes('result.json  100%') && !profile.includes('result.json.task  100%'), 'bare containers are not listed as fields')
assert.ok(!/result\.json\.task\.id .*one of/.test(profile)); assert.ok(corpusSummary(t).includes('typical'))

// A rule checked against history: never-present fields are refusals, rare ones warnings.
const rule = (blocks: unknown[], title = '{{input.id}}') => parseCardRule({ id: 'r', status: 'draft', match: { tool: TOOL }, title, blocks }).rule!
const cov = profileCoverage(rule([{ type: 'text', text: '{{result.json.task.status}} {{result.json.nope}} {{result.json.diff}}' }, { type: 'kv', rows: [['Files', '{{result.json.task.files | count}}'], ['First', '{{result.json.task.files.0.path}}'], ['V', '{{input.verbose}}'], ['X', '{{input.ghost}}']] }]), t)
assert.deepEqual(cov.never, ['result.json.nope was never present in 10 past JSON results', 'input.ghost was never passed in 11 past calls'])
assert.deepEqual(cov.rare, ['result.json.diff is present in only 10% of 10 past JSON results', 'input.verbose is passed in only 45% of 11 past calls'])
assert.deepEqual(profileCoverage(rule([]), undefined), { never: [], rare: [] }, 'no history, no opinion')
const few = emptyCorpus(); ingestCall(few, { tool: TOOL, at: 1, input: {}, result: result({ a: 1 }) })
assert.deepEqual(profileCoverage(rule([{ type: 'text', text: '{{result.json.zzz}}' }]), few.tools[TOOL]).never, [], 'a handful of calls is not evidence')
const text = emptyCorpus(); for (let i = 0; i < 9; i++) ingestCall(text, { tool: 'mcp__a__plain', at: i, input: {}, result: { text: 'plain words', isError: false } })
assert.ok(profileCoverage(rule([{ type: 'text', text: '{{result.json.x}}' }]), text.tools.mcp__a__plain).never.some(message => message.includes('never JSON') && message.includes('use result.text')))
assert.ok(corpusProfileText(text.tools.mcp__a__plain!).includes('bind result.text'))

// Bounds.
const bounded = emptyCorpus()
for (let i = 0; i < CORPUS_LIMITS.tools + 30; i++) ingestCall(bounded, { tool: `mcp__s__t${i}`, at: i, input: {}, result: result({ a: 1 }) })
assert.ok(Object.keys(bounded.tools).length <= CORPUS_LIMITS.tools)
const wide = emptyCorpus(); ingestCall(wide, { tool: 'mcp__w__x', at: 1, input: {}, result: result(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]))) })
assert.ok(Object.keys(wide.tools.mcp__w__x!.fields).length <= CORPUS_LIMITS.fieldsPerTool); assert.ok(Object.keys(wide.tools.mcp__w__x!.fields).length > 0)

// The scan: incremental, newest first, limited, abortable, persisted.
const wire = (n: number) => [
  { timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_use', id: `u${n}`, name: TOOL, input: { id: `S${n}` } }, { type: 'tool_use', id: `b${n}`, name: 'Bash', input: { command: 'ls' } }] } },
  { timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: `u${n}`, content: [{ type: 'text', text: JSON.stringify({ task: { status: 'completed' } }) }] }, { type: 'tool_result', tool_use_id: `b${n}`, content: 'a' }] } },
]
const reads: string[] = []
const source = { list: async () => Array.from({ length: 7 }, (_, i) => ({ key: `claude:s${i}`, lastModified: 100 + i })), read: async (session: { key: string }) => { reads.push(session.key); if (session.key === 'claude:s3') throw new Error('unreadable'); return wire(Number(session.key.slice(-1))) } }
const scan = emptyCorpus()
const first = await scanHistory(scan, source, { maxSessions: 3 })
assert.deepEqual(reads, ['claude:s6', 'claude:s5', 'claude:s4'], 'newest first'); assert.equal(first.stopped, 'limit'); assert.equal(first.remaining, 4); assert.equal(first.scanned, 3)
assert.equal(scan.tools[TOOL]!.calls, 3); assert.equal(scan.tools[TOOL]!.sessions, 3); assert.equal(scan.tools.Bash, undefined)
assert.equal(loadCorpus().tools[TOOL]!.calls, 3, 'the scan persists')
const second = await scanHistory(scan, source); assert.equal(second.stopped, 'done'); assert.deepEqual(reads.slice(3), ['claude:s3', 'claude:s2', 'claude:s1', 'claude:s0'], 'only what was not read before')
assert.equal(scan.tools[TOOL]!.calls, 6, 'an unreadable session is skipped, never counted'); assert.equal((await scanHistory(scan, source)).scanned, 0, 'nothing is read twice')
const aborted = new AbortController(); aborted.abort()
assert.equal((await scanHistory(emptyCorpus(), source, { signal: aborted.signal })).stopped, 'aborted')
let clock = 0
assert.equal((await scanHistory(emptyCorpus(), { ...source, read: async () => { clock += 100; return [] } }, { deadlineMs: 150, now: () => clock })).stopped, 'deadline')
console.log('adaptiveCorpusSmoke: ok')
