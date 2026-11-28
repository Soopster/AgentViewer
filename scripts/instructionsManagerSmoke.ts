import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInstructionsManager } from '../lib/instructions-manager/service'
import type { InstructionsContext } from '../lib/instructions-manager/discovery'
import type { InstructionChange } from '../lib/plugins/instructionsManager'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'instructions-'))), cwd = path.join(temp, 'repo'), home = path.join(temp, 'home')
await mkdir(path.join(cwd, '.git'), { recursive: true }); await mkdir(home)
const accounts: InstructionsContext['instances'] = [
  { id: 'claude-work', provider: 'claude', displayName: 'Claude work', environment: { CLAUDE_CONFIG_DIR: path.join(home, '.claude-work') } },
  { id: 'claude-same', provider: 'claude', displayName: 'Claude alias', environment: { CLAUDE_CONFIG_DIR: path.join(home, '.claude-work') } },
  { id: 'codex', provider: 'codex', displayName: 'Codex', environment: {} },
  { id: 'pi', provider: 'pi', displayName: 'Pi', environment: {} },
  { id: 'opencode', provider: 'opencode', displayName: 'OpenCode', environment: {} },
  { id: 'copilot', provider: 'copilot', displayName: 'Copilot', environment: {} },
]
const context: InstructionsContext = { home, environment: {}, instances: accounts, dataDir: path.join(temp, 'manager') }, manager = createInstructionsManager(async () => context)
async function put(file: string, text: string) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text) }
const source = path.join(cwd, 'AGENTS.md'), target = path.join(cwd, 'CLAUDE.md')
try {
  await put(source, '# Project conventions\n\nRead @docs/design.md before changes.\n')
  await put(target, '# Claude-specific instructions\n')
  await put(path.join(temp, 'AGENTS.md'), 'Parent instructions')
  await put(path.join(cwd, 'src', 'AGENTS.md'), 'Nested instructions')
  await put(path.join(cwd, '.claude', 'rules', 'typescript.md'), '---\npaths:\n  - "src/**/*.ts"\n---\n# TypeScript rules\n')
  await put(path.join(cwd, '.github', 'instructions', 'tests.instructions.md'), '---\napplyTo: "**/*.test.ts"\n---\n# Test rules\n')
  await put(path.join(home, '.claude-work', 'CLAUDE.md'), '# User policy\n')
  await put(path.join(cwd, 'node_modules', 'bad', 'AGENTS.md'), 'Ignore dependency')
  let snapshot = await manager.scan(cwd)
  assert.equal(snapshot.files.filter(file => file.path === path.join(home, '.claude-work', 'CLAUDE.md')).length, 1)
  assert.equal(snapshot.files.find(file => file.path === path.join(home, '.claude-work', 'CLAUDE.md'))?.consumers.length, 2)
  assert(snapshot.files.some(file => file.scope === 'nested' && file.path.endsWith('src/AGENTS.md')))
  assert(!snapshot.files.some(file => file.path.includes('node_modules')))
  assert.equal(snapshot.files.find(file => file.path === path.join(temp, 'AGENTS.md'))?.writable, false)
  const rule = await manager.read(cwd, '.claude/rules/typescript.md'); assert(rule.metadata.includes('src/**/*.ts'))
  const original = await manager.read(cwd, source); assert.deepEqual(original.references, ['docs/design.md'])
  const destination = await manager.read(cwd, target)
  const change: InstructionChange = { path: target, text: original.text, expectedHash: destination.hash, source: { path: source, hash: original.hash! } }
  const preview = await manager.preview(cwd, change)
  assert.equal(preview.status, 'replace'); assert.equal(await readFile(target, 'utf8'), destination.text)
  await assert.rejects(manager.apply(cwd, 'copy', preview.hash, change, false), /Confirm replacement/)
  const receipt = await manager.apply(cwd, 'copy', preview.hash, change, true)
  assert(receipt.backup); assert.equal(await readFile(receipt.backup, 'utf8'), destination.text)
  assert.equal(await readFile(target, 'utf8'), original.text)
  assert.equal(await readFile(source, 'utf8'), original.text)
  assert.equal((await manager.apply(cwd, 'copy', preview.hash, change, true)).backup, receipt.backup)
  await assert.rejects(manager.apply(cwd, 'copy', preview.hash, { ...change, text: 'different' }, true), /different instruction change/)
  const edit: InstructionChange = { path: source, text: 'Edited instruction\n', expectedHash: original.hash }
  const editPreview = await manager.preview(cwd, edit)
  await writeFile(source, 'Externally changed\n')
  await assert.rejects(manager.apply(cwd, 'stale-edit', editPreview.hash, edit, true), /changed/)
  await assert.rejects(manager.preview(cwd, { ...change, expectedHash: (await manager.read(cwd, target)).hash }), /source changed/)
  const newRule = path.join(cwd, '.github', 'instructions', 'new.instructions.md')
  const create: InstructionChange = { path: newRule, text: '---\napplyTo: "src/**"\n---\nUse explicit account identities.\n', expectedHash: null }
  const createPreview = await manager.preview(cwd, create)
  assert.equal(createPreview.status, 'create')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(manager.apply(cwd, 'aborted', createPreview.hash, create, false, controller.signal))
  assert.equal((await manager.read(cwd, newRule)).hash, null)
  await manager.apply(cwd, 'new-rule', createPreview.hash, create, false)
  assert.equal(await readFile(newRule, 'utf8'), create.text)
  await assert.rejects(manager.preview(cwd, { ...create, path: path.join(cwd, 'unrelated.md') }), /known instruction/)
  await assert.rejects(manager.preview(cwd, { ...create, path: path.join(temp, 'AGENTS.md'), expectedHash: (await manager.read(cwd, path.join(temp, 'AGENTS.md'))).hash }), /read-only/)
  await symlink(source, path.join(cwd, 'CLAUDE.local.md'))
  const linked = await manager.read(cwd, 'CLAUDE.local.md'); assert(linked.file.linked)
  await assert.rejects(manager.preview(cwd, { path: linked.file.path, text: 'No', expectedHash: linked.hash }), /Linked/)
  const sub = path.join(cwd, 'linked'); await symlink(home, sub)
  await assert.rejects(manager.preview(cwd, { path: path.join(sub, '.claude', 'rules', 'escape.md'), text: 'No', expectedHash: null }), /known instruction/)
  await put(path.join(cwd, '.github', 'instructions', 'binary.instructions.md'), '\0bad')
  await assert.rejects(manager.read(cwd, '.github/instructions/binary.instructions.md'), /Binary/)
  await put(path.join(cwd, '.claude', 'rules', 'big.md'), 'x'.repeat(256 * 1024 + 1))
  await assert.rejects(manager.read(cwd, '.claude/rules/big.md'), /256 KiB/)
  snapshot = await manager.scan(cwd); assert.equal(snapshot.receipts.length, 2)
  // Concurrent create-only operations never overwrite another completed writer.
  const concurrent: InstructionChange = { path: path.join(cwd, '.claude/rules/concurrent.md'), text: 'Keep one writer\n', expectedHash: null }
  const concurrentPreview = await manager.preview(cwd, concurrent)
  const results = await Promise.allSettled(['one', 'two'].map(id => manager.apply(cwd, id, concurrentPreview.hash, concurrent, false)))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  console.log('Instructions Manager: PASS (scopes, account deduplication, nested rules, metadata/imports, copy previews, independent copies, replacement consent, backups, replay, stale writes/sources, creation, cancellation, link boundaries, limits, concurrent writes)')
} finally { await rm(temp, { recursive: true, force: true }) }
