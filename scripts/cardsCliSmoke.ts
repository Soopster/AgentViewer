// `agent-viewer cards`: the words an agent reads after writing a rule file, and exit codes a script can branch on.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = mkdtempSync(join(tmpdir(), 'cards-cli-'))
const env = { ...process.env, AGENT_VIEWER_UI_RECIPES_DIR: dir }
const cli = (...args: string[]) => { const r = spawnSync(process.execPath, ['run', join(import.meta.dir, '..', 'bin', 'agent-viewer-cards.ts'), ...args], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr } }
const good = { id: 'ok', status: 'draft', match: { tool: 'mcp__a__b' }, title: '{{input.q}}', blocks: [{ type: 'text', text: '{{result.text | truncate 10}}' }], samples: [{ input: { q: 'hi' }, result: { text: 'a long result string' } }] }
writeFileSync(join(dir, 'ok.json'), JSON.stringify(good))
writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...good, id: 'bad', match: { tool: '*' }, title: '{{input.q | eval}}' }))
writeFileSync(join(dir, 'broken.json'), '{ nope')

let r = cli('check')
assert.equal(r.code, 1); assert.ok(r.out.includes('ok       ') && r.out.includes('INVALID') && r.out.includes('unknown formatter "eval"') && r.out.includes('"*" alone'))
r = cli('check', 'ok'); assert.equal(r.code, 0, r.err); assert.deepEqual(JSON.parse(cli('check', 'ok', '--json').out), [{ file: join(dir, 'ok.json'), valid: true, problems: [] }])
r = cli('check', 'broken'); assert.equal(r.code, 1); assert.ok(r.out.includes('INVALID'))
r = cli('preview', 'ok'); assert.equal(r.code, 0); assert.ok(r.out.includes('hi') && r.out.includes('a long re…'), r.out)
assert.equal(cli('preview', 'bad').code, 1)
assert.equal(cli('enable', 'ok').code, 0); assert.equal(JSON.parse(readFileSync(join(dir, 'ok.json'), 'utf8')).status, 'active')
assert.equal(cli('disable', 'ok').code, 0); assert.equal(JSON.parse(readFileSync(join(dir, 'ok.json'), 'utf8')).status, 'disabled')
r = cli('enable', 'missing'); assert.equal(r.code, 1); assert.ok(r.err.includes('no card rule'))
assert.equal(cli('bogus').code, 2); assert.equal(cli().code, 2)
console.log('cardsCliSmoke: ok')
