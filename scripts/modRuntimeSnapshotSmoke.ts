import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, realpathSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { snapshotLocalModEntry, MOD_RUNTIME_SNAPSHOT_LIMITS } from '../lib/plugins/modRuntimeSnapshot'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-runtime-snapshot-'))
const source = path.join(temp, 'source'), helper = path.join(source, 'helper.mjs'), entry = path.join(source, 'server.mjs'), marker = path.join(temp, 'executed')
mkdirSync(source)
writeFileSync(path.join(source, 'package.json'), '{"type":"module"}')
writeFileSync(path.join(source, 'asset.txt'), 'asset-one')
writeFileSync(helper, `export const value='one'`)
writeFileSync(entry, `import {writeFileSync,readFileSync} from 'node:fs'; import {value} from './helper.mjs'; writeFileSync(${JSON.stringify(marker)},'ran'); export const answer=value; export const asset=readFileSync(new URL('./asset.txt',import.meta.url),'utf8'); export {default as dependency} from 'fixture-dependency';`)
const dependencies = path.join(temp, 'node_modules', 'fixture-dependency'); mkdirSync(dependencies, { recursive: true })
writeFileSync(path.join(dependencies, 'package.json'), '{"name":"fixture-dependency","type":"module","main":"index.js"}')
writeFileSync(path.join(dependencies, 'index.js'), 'export default "dependency-ok"')
const importModule = new Function('file', 'return import(file)') as (file: string) => Promise<Record<string, unknown>>
try {
  const one = snapshotLocalModEntry(source, entry, 'revision-one')
  assert(!existsSync(marker), 'snapshot must never execute source')
  assert.equal(snapshotLocalModEntry(source, entry, 'revision-one'), one)
  assert.equal(readFileSync(path.join(path.dirname(one), 'package.json'), 'utf8'), '{"type":"module"}')
  assert.equal(realpathSync(path.join(path.dirname(one), 'node_modules')), realpathSync(path.join(temp, 'node_modules')))
  const first = await importModule(pathToFileURL(one).href)
  assert.equal(first.answer, 'one'); assert.equal(first.asset, 'asset-one'); assert.equal(first.dependency, 'dependency-ok')
  writeFileSync(helper, `export const value='two'`); writeFileSync(path.join(source, 'asset.txt'), 'asset-two')
  const two = snapshotLocalModEntry(source, entry, 'revision-two')
  assert.notEqual(one, two)
  const second = await importModule(pathToFileURL(two).href)
  assert.equal(second.answer, 'two'); assert.equal(second.asset, 'asset-two')
  assert.equal((await importModule(pathToFileURL(one).href)).answer, 'one', 'old snapshot keeps its helper identity')
  const active = path.join(temp, 'active'); symlinkSync(source, active, 'dir')
  const linked = snapshotLocalModEntry(active, path.join(active, 'server.mjs'), 'linked')
  assert.equal((await importModule(pathToFileURL(linked).href)).answer, 'two')
  symlinkSync(path.join(temp, 'asset-outside'), path.join(source, 'unsafe'))
  assert.throws(() => snapshotLocalModEntry(source, entry, 'bad-symlink'), /symlink/); rmSync(path.join(source, 'unsafe'))
  const oversized = path.join(source, 'too-large'); writeFileSync(oversized, ''); truncateSync(oversized, MOD_RUNTIME_SNAPSHOT_LIMITS.fileBytes + 1)
  assert.throws(() => snapshotLocalModEntry(source, entry, 'too-large'), /limits/); rmSync(oversized)
  mkdirSync(path.join(source, '.git')); writeFileSync(path.join(source, '.git', 'ignored'), 'ignored')
  assert(!existsSync(path.join(path.dirname(snapshotLocalModEntry(source, entry, 'ignore-git')), '.git')))
  assert.throws(() => snapshotLocalModEntry(source, path.join(temp, 'outside.mjs'), 'outside'), /outside/)
  const many = path.join(temp, 'many'); mkdirSync(many)
  for (let i = 0; i <= MOD_RUNTIME_SNAPSHOT_LIMITS.files; i++) writeFileSync(path.join(many, `${i}.mjs`), 'export {}')
  assert.throws(() => snapshotLocalModEntry(many, '0.mjs', 'too-many'), /limits/)
  // The process-lifetime root is removed when its owner exits.
  const childScript = path.join(temp, 'child.ts')
  writeFileSync(childScript, `import {snapshotLocalModEntry} from ${JSON.stringify(path.join(process.cwd(), 'lib/plugins/modRuntimeSnapshot.ts'))}; console.log(snapshotLocalModEntry(${JSON.stringify(source)},${JSON.stringify(entry)},'child'))`)
  const child = spawnSync(process.execPath, ['run', childScript], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr); assert(!existsSync(child.stdout.trim()), 'exit must remove snapshot files')
  console.log('Mod runtime snapshots: PASS (fresh relative dependencies, assets/package metadata, node_modules resolution, cache, installed symlink roots, limits/symlink refusal, no import side effects and exit cleanup)')
} finally { rmSync(temp, { recursive: true, force: true }) }
