// What a model reads from the board must not scale with how much evidence a run
// has published. A finding carries up to 32,000 characters and a hundred stay
// in view, so every status call once repeated all of it; the size of a tool
// result has no other observable than counting it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-status-bound-'))
process.chdir(cwd)
execFileSync('git', ['init', '-q'])
writeFileSync('.gitignore', '.agent-viewer-data/\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'baseline'])
const coord = await import('../lib/agentCoordination')
const { executeExternalCoordinatorAction: execute } = await import('../lib/agentCoordinationExternal')
const { buildCoordinatorPiTools } = await import('../lib/agentCoordinationSdkTools')

const lead = (await coord.createExternalProtocolRun({ prompt: 'Audit', provider: 'codex', baseCwd: cwd, participantName: 'lead' })).participant
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, provider: 'codex', cwd, participantName: 'worker' })).participant

const EVIDENCE = 32_000
const FINDINGS = 30
const before = (await execute({ ...lead, action: 'status' }) as { cursor: string }).cursor
for (let index = 0; index < FINDINGS; index += 1) {
  await execute({
    ...worker, action: 'finding', requestId: `finding-${index}`, kind: 'finding',
    summary: `Unvalidated input in handler${index}quartz`, detail: `${'e'.repeat(EVIDENCE - 4)}${String(index).padStart(4, '0')}`,
  })
}

const status = await execute({ ...lead, action: 'status' }) as { snapshot: { events: Array<{ type: string; detail?: string }> } }
const findings = status.snapshot.events.filter((event) => event.type === 'finding')
assert.equal(findings.length, FINDINGS, 'every finding is still listed')
assert.ok(JSON.stringify(status).length < 60_000, `status stayed small (${JSON.stringify(status).length} chars for ${FINDINGS * EVIDENCE} of evidence)`)
for (const finding of findings) {
  assert.ok((finding.detail?.length ?? 0) < 800, 'a listed finding carries an excerpt, not its evidence')
  assert.match(finding.detail ?? '', /coord_query_context returns the full text/, 'and says where the rest is')
}

// The excerpt is only acceptable because the whole text is still reachable.
const found = await execute({ ...lead, action: 'query_context', query: 'handler7quartz', limit: 5 }) as { results: Array<{ summary: string; detail?: string }> }
assert.equal(found.results[0]?.summary, 'Unvalidated input in handler7quartz')
assert.ok(found.results[0].detail?.length === EVIDENCE && found.results[0].detail.endsWith('0007'), 'the full evidence is retrievable')
// A broad query matches every finding; it must not return all of them whole.
const broad = await execute({ ...lead, action: 'query_context', query: 'unvalidated input', limit: 20 }) as { results: Array<{ detail?: string }> }
assert.equal(broad.results.length, 20)
assert.equal(broad.results[0].detail?.length, EVIDENCE, 'the best match is whole')
assert.ok(JSON.stringify(broad).length < 90_000, `a broad query stays bounded (${JSON.stringify(broad).length})`)

const waited = await execute({ ...lead, action: 'wait', cursor: before, timeoutMs: 0 }) as { events: Array<{ type: string; detail?: string }>; snapshot?: unknown }
assert.ok(waited.events.some((event) => event.type === 'finding'), 'a wait reports the new findings')
assert.ok(waited.events.every((event) => (event.detail?.length ?? 0) < 2_200), 'at reading length, not in full')
assert.ok(waited.snapshot, 'the supervisor still gets the board from a wait')

// An in-app session reads the tool result itself, so the board must not ride along.
const waitTool = buildCoordinatorPiTools(lead).find((tool) => tool.name === 'coord_wait')!
const execution = await (waitTool.execute as unknown as (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text?: string }> }>)('call', { cursor: before, timeout_ms: 0 })
const toolResult = JSON.parse(execution.content[0].text ?? '{}')
assert.equal(toolResult.snapshot, undefined, 'an in-app coord_wait does not carry the whole board')
assert.ok(Array.isArray(toolResult.events) && toolResult.actionable, 'it keeps the events and the digest')

console.log(`Status bound: ${FINDINGS} findings of ${EVIDENCE} characters cost ${JSON.stringify(status).length} characters of status, full text via a specific query, a broad query bounded, in-app wait without the board`)
process.exit(0)
