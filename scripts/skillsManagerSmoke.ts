import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, lstat, symlink, chmod, access } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createSkillsManager } from '../lib/skills-manager/service'
import { readSkillBundle } from '../lib/skills-manager/files'
import type { SkillsContext } from '../lib/skills-manager/roots'
import type { SkillCopyPreview } from '../lib/plugins/skillsManager'
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'skills-manager-'))), home = path.join(temporary, 'home'), cwd = path.join(temporary, 'repo')
await mkdir(home); await mkdir(cwd)
const context: SkillsContext = { home, environment: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }, dataDir: path.join(temporary, 'state'), instances: [
  { id: 'claude', provider: 'claude', displayName: 'Claude', environment: {} },
  { id: 'claude-shared', provider: 'claude', displayName: 'Claude shared account', environment: {} },
  { id: 'claude-work', provider: 'claude', displayName: 'Claude Work', environment: { CLAUDE_CONFIG_DIR: path.join(home, 'claude-work') } },
  { id: 'codex', provider: 'codex', displayName: 'Codex', environment: {} },
  { id: 'opencode', provider: 'opencode', displayName: 'OpenCode', environment: {} },
  { id: 'pi', provider: 'pi', displayName: 'Pi', environment: {} },
  { id: 'copilot', provider: 'copilot', displayName: 'Copilot', environment: {} },
] }
const service = createSkillsManager(async () => context)
const sourceDirectory = path.join(home, '.claude', 'skills', 'demo')
const text = '---\nname: demo\ndescription: A reusable test skill\n---\n# Demo skill\nUse the supporting files.\n'
async function file(relative: string, contents: string | Uint8Array) { const target = path.join(sourceDirectory, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, contents) }
const apply = (preview: SkillCopyPreview, replaceIds: string[] = [], requestId = crypto.randomUUID()) => service.apply(cwd, { sourceId: preview.sourceId, targetIds: preview.targets.map(target => target.rootId), previewId: preview.id, replaceIds, requestId })
try {
  await file('SKILL.md', text); await file('references/guide.md', 'Original guide'); await file('scripts/check.sh', '#!/bin/sh\necho NEVER_RUN'); await file('assets/image.png', new Uint8Array([137, 80, 78, 71, 0, 1, 2])); await chmod(path.join(sourceDirectory, 'scripts/check.sh'), 0o755)
  let snapshot = await service.scan(cwd)
  const source = snapshot.skills.find(skill => skill.name === 'demo')!, sourceRoot = snapshot.roots.find(root => root.id === source.rootId)!
  assert(source.syncable)
  assert.equal(source.files.length, 4)
  assert(sourceRoot.consumers.includes('Claude (claude)') && sourceRoot.consumers.includes('Claude shared account (claude-shared)'), 'shared account folders are one location')
  assert(snapshot.roots.some(root => root.path === path.join(home, 'claude-work', 'skills')), 'configured accounts get their own roots')
  const target = snapshot.roots.find(root => root.path === path.join(cwd, '.opencode', 'skills'))!
  assert(target && !target.exists)
  await assert.rejects(access(target.path))
  assert((await service.file(cwd, source.id, 'SKILL.md')).text.includes('# Demo skill'))
  assert.equal((await service.file(cwd, source.id, 'assets/image.png')).binary, true)
  await assert.rejects(service.file(cwd, source.id, '../outside'), /Invalid/)
  let preview = await service.preview(cwd, { sourceId: source.id, targetIds: [target.id] })
  assert.equal(preview.targets[0].status, 'add')
  assert.equal(preview.targets[0].files.length, 4)
  await assert.rejects(access(target.path), 'preview creates no provider folders')
  await assert.rejects(access(context.dataDir), 'preview creates no state folders')
  const requestId = crypto.randomUUID(), receipt = await apply(preview, [], requestId)
  assert.equal(receipt.status, 'applied')
  const destination = path.join(target.path, 'demo')
  assert(!(await lstat(destination)).isSymbolicLink(), 'sync creates an independent copy')
  assert.equal(await readFile(path.join(destination, 'references/guide.md'), 'utf8'), 'Original guide')
  assert.equal((await lstat(path.join(destination, 'scripts/check.sh'))).mode & 0o777, 0o755)
  assert.equal((await readSkillBundle(sourceDirectory)).hash, (await readSkillBundle(destination)).hash)
  assert.equal((await apply(preview, [], requestId)).id, receipt.id, 'request replay returns the same receipt')
  await assert.rejects(apply(preview), /changed/)
  preview = await service.preview(cwd, { sourceId: source.id, targetIds: [target.id] })
  assert.equal(preview.targets[0].status, 'same')
  assert.equal((await apply(preview)).results[0].status, 'unchanged')
  await file('references/guide.md', 'New guide')
  preview = await service.preview(cwd, { sourceId: source.id, targetIds: [target.id] })
  assert.equal(preview.targets[0].status, 'replace')
  await assert.rejects(apply(preview), /Explicitly/)
  assert.equal(await readFile(path.join(destination, 'references/guide.md'), 'utf8'), 'Original guide')
  const replaced = await apply(preview, [target.id])
  assert.equal(replaced.status, 'applied')
  assert.equal(await readFile(path.join(replaced.results[0].backup!, 'references/guide.md'), 'utf8'), 'Original guide')
  assert.equal(await readFile(path.join(destination, 'references/guide.md'), 'utf8'), 'New guide')
  // Both a changed source and a changed destination fence an old preview.
  preview = await service.preview(cwd, { sourceId: source.id, targetIds: [target.id] })
  await file('references/guide.md', 'Source changed after preview')
  await assert.rejects(apply(preview, [target.id]), /changed/)
  preview = await service.preview(cwd, { sourceId: source.id, targetIds: [target.id] })
  await writeFile(path.join(destination, 'references/guide.md'), 'Destination edited locally')
  await assert.rejects(apply(preview, [target.id]), /changed/)
  assert.equal(await readFile(path.join(destination, 'references/guide.md'), 'utf8'), 'Destination edited locally')
  // An internal symlink cannot expose or copy a file outside the selected bundle.
  await file('linked/SKILL.md', text)
  const external = path.join(temporary, 'outside.txt'); await writeFile(external, 'PRIVATE OUTSIDE CONTENT')
  await symlink(external, path.join(sourceDirectory, 'linked', 'escape.txt'))
  await assert.rejects(readSkillBundle(path.join(sourceDirectory, 'linked')), /Linked resource/)
  await assert.rejects(service.file(cwd, source.id, 'linked/escape.txt'), /Linked resources/)
  await rm(path.join(sourceDirectory, 'linked'), { recursive: true })
  await symlink(sourceDirectory, path.join(home, '.claude', 'skills', 'alias'))
  snapshot = await service.scan(cwd)
  assert(snapshot.skills.find(skill => skill.key === 'alias')?.linked, 'linked top-level skills remain browsable')
  const sys = path.join(home, '.codex', 'skills', '.system', 'builtin'); await mkdir(sys, { recursive: true }); await writeFile(path.join(sys, 'SKILL.md'), text)
  snapshot = await service.scan(cwd)
  assert.equal(snapshot.skills.find(skill => skill.key === '.system/builtin')?.syncable, false)
  // Replacements never discard excluded local resources that were absent from a preview.
  await mkdir(path.join(destination, 'node_modules')); await writeFile(path.join(destination, 'node_modules', 'keep.txt'), 'local')
  preview = await service.preview(cwd, { sourceId: source.id, targetIds: [target.id] })
  assert.equal(preview.targets[0].status, 'blocked')
  await assert.rejects(apply(preview, [target.id]), /blocked/)
  assert.equal(await readFile(path.join(destination, 'node_modules', 'keep.txt'), 'utf8'), 'local')
  await rm(path.join(destination, 'node_modules'), { recursive: true })
  // The configured account root changing invalidates its old location ID.
  const work = snapshot.roots.find(root => root.path === path.join(home, 'claude-work', 'skills'))!
  preview = await service.preview(cwd, { sourceId: source.id, targetIds: [work.id] })
  context.instances.find(instance => instance.id === 'claude-work')!.environment.CLAUDE_CONFIG_DIR = path.join(home, 'moved-work')
  await assert.rejects(apply(preview), /location/)
  assert((await service.scan(cwd)).receipts.some(item => item.id === replaced.id))
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(service.scan(cwd, aborted.signal), /abort/i)
  console.log('Skills Manager: PASS (account roots, shared locations, full bundles, binary resources, modes, independent copies, previews, stale state, replacement consent, backups, idempotency, link boundaries, system skills, receipts, cancellation)')
} finally { await rm(temporary, { recursive: true, force: true }) }
