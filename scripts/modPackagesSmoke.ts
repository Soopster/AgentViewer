import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { inspectModPackage, installModPackage, listModPackages, removeModPackage, rollbackModPackage } from '../lib/plugins/modPackages'
import { parseModPackageMetadata } from '../lib/plugins/modPackageMetadata'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-packages-')), plugins = path.join(temp, 'plugins')
const previous = process.env.AGENT_VIEWER_PLUGINS_DIR
process.env.AGENT_VIEWER_PLUGINS_DIR = plugins
const source = path.join(temp, 'source'); mkdirSync(source)
const marker = path.join(temp, 'executed')
const put = (version: string, extra: Record<string, unknown> = {}) => {
  writeFileSync(path.join(source, 'plugin.json'), JSON.stringify({ id: 'packaged', version, hostApi: { min: 1, max: 1 }, commands: [{ id: 'hello' }], ...extra }))
  writeFileSync(path.join(source, 'server.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export const commands = {hello:()=>({notice:'${version}'})}`)
}
try {
  for (const version of ['invalid', '1.0.0-..', '1.0.0-01', '01.0.0']) assert.throws(() => parseModPackageMetadata({ version }))
  assert.equal(parseModPackageMetadata({ version: '1.0.0-beta.1+build.2' }).version, '1.0.0-beta.1+build.2')
  assert.throws(() => parseModPackageMetadata({ hostApi: { min: 999 } }), { message: /requires host API/ })
  put('1.0.0')
  const one = inspectModPackage(source)
  assert(!existsSync(marker), 'inspection must not execute package code')
  assert.throws(() => installModPackage(source, '0'.repeat(64)), /digest does not match/)
  let state = installModPackage(source, one.sha256)
  assert.equal(state.current?.version, '1.0.0')
  assert.equal(readlinkSync(path.join(plugins, 'packaged')), path.join(temp, 'mod-packages', 'packaged', 'releases', one.sha256, 'content'))
  assert(!existsSync(marker), 'installation must not execute package code')
  assert.throws(() => installModPackage(source, one.sha256), /use update/)
  mkdirSync(path.join(temp, 'mod-settings')); writeFileSync(path.join(temp, 'mod-settings', 'packaged.json'), '{"keep":true}')
  put('2.0.0'); const two = inspectModPackage(source)
  state = installModPackage(source, two.sha256, 'packaged')
  assert.equal(state.current?.version, '2.0.0'); assert.equal(state.history[0]?.sha256, one.sha256)
  assert.equal(listModPackages()[0]?.dirty, false)
  assert.equal(rollbackModPackage('packaged').current?.sha256, one.sha256)
  assert.equal(rollbackModPackage('packaged').current?.sha256, two.sha256)
  const active = path.join(plugins, 'packaged')
  writeFileSync(path.join(active, 'server.mjs'), '// local change')
  assert.equal(listModPackages()[0]?.dirty, true)
  assert.throws(() => removeModPackage('packaged'), /local edits/)
  assert.throws(() => rollbackModPackage('packaged'), /local edits/)
  writeFileSync(path.join(active, 'server.mjs'), readFileSync(path.join(source, 'server.mjs')))
  mkdirSync(path.join(active, 'node_modules')); writeFileSync(path.join(active, 'node_modules', 'injected.js'), '// unexpected')
  assert.equal(listModPackages()[0]?.dirty, true)
  assert.throws(() => removeModPackage('packaged'), /unexpected excluded/)
  rmSync(path.join(active, 'node_modules'), { recursive: true })
  assert.equal(removeModPackage('packaged').current, null)
  assert(!existsSync(active)); assert.equal(readFileSync(path.join(temp, 'mod-settings', 'packaged.json'), 'utf8'), '{"keep":true}')
  assert.equal(rollbackModPackage('packaged').current?.version, '2.0.0')
  // A journal with an unchanged pointer recovers the old state, not its staged target.
  const stateFile = path.join(temp, 'mod-packages', 'packaged', 'state.json')
  const before = JSON.parse(readFileSync(stateFile, 'utf8'))
  writeFileSync(path.join(path.dirname(stateFile), 'pending.json'), JSON.stringify({ before, after: { ...before, current: null } }))
  assert.equal(listModPackages()[0]?.current?.version, '2.0.0')
  assert(!existsSync(path.join(path.dirname(stateFile), 'pending.json')))
  // A crash after pointer replacement finishes the new state record.
  writeFileSync(path.join(path.dirname(stateFile), 'pending.json'), JSON.stringify({ before, after: { ...before, current: null, history: [before.current, ...before.history] } }))
  rmSync(active)
  assert.equal(listModPackages()[0]?.current, null)
  assert.equal(rollbackModPackage('packaged').current?.version, '2.0.0')
  mkdirSync(path.join(plugins, 'unmanaged'))
  put('1.0.0', { id: 'unmanaged' }); const unmanaged = inspectModPackage(source)
  assert.throws(() => installModPackage(source, unmanaged.sha256), /unmanaged directory/)
  put('3.0.0', { hostApi: { min: 999 } }); assert.throws(() => inspectModPackage(source), /requires host API/)
  put('3.0.0'); writeFileSync(path.join(source, 'server.mjs'), 'export const = broken'); assert.throws(() => inspectModPackage(source))
  put('3.0.0'); symlinkSync('/tmp', path.join(source, 'linked')); assert.throws(() => inspectModPackage(source), /symlinks/); rmSync(path.join(source, 'linked'))
  const cli = spawnSync(process.execPath, ['run', 'bin/agent-viewer-mod-packages.ts', 'list'], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).ok, true)
  console.log('Mod packages: PASS (static inspection, digest pins, compatibility, atomic symlink activation, updates/history, dirty/unmanaged refusal, removal/config preservation, rollback, journal recovery and CLI)')
} finally { if (previous === undefined) delete process.env.AGENT_VIEWER_PLUGINS_DIR; else process.env.AGENT_VIEWER_PLUGINS_DIR = previous; rmSync(temp, { recursive: true, force: true }) }
