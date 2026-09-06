import assert from 'node:assert/strict'
import { mkdtemp, readFile, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditorDiskReader } from './editorDiskReader'

const root = await mkdtemp(join(tmpdir(), 'editor-disk-reader-'))
const outside = await mkdtemp(join(tmpdir(), 'editor-disk-reader-outside-'))
try {
  const path = join(root, 'file.txt')
  const original = 'one\r\n'.repeat(200_000)
  await writeFile(path, original)
  const reader = createEditorDiskReader(root)
  const first = await reader.read('file.txt')
  assert.equal(first.disk, 'one\n'.repeat(200_000))
  assert.equal(first.lineEnding, '\r\n')
  const cachedStart = performance.now()
  for (let i = 0; i < 20; i++) assert.equal(await reader.read('file.txt'), first)
  const cachedMs = performance.now() - cachedStart
  const rawStart = performance.now()
  for (let i = 0; i < 20; i++) await readFile(path, 'utf8')
  const rawMs = performance.now() - rawStart
  await writeFile(path, original.replace('one', 'two'))
  assert.ok((await reader.read('file.txt')).disk.startsWith('two\n'))
  const stamp = new Date(1_700_000_000_000)
  await utimes(path, stamp, stamp)
  const before = await reader.read('file.txt')
  await writeFile(path, original)
  await utimes(path, stamp, stamp)
  assert.notEqual(await reader.read('file.txt'), before, 'ctime detects same-size edits with restored mtime')
  await writeFile(join(root, 'replacement.txt'), 'replacement\n')
  await rename(join(root, 'replacement.txt'), path)
  assert.equal((await reader.read('file.txt')).disk, 'replacement\n')
  await unlink(path)
  await assert.rejects(reader.read('file.txt'))
  await writeFile(path, 'recreated\n')
  assert.equal((await reader.read('file.txt')).disk, 'recreated\n')
  const retained = await reader.read('file.txt')
  reader.retain([])
  assert.notEqual(await reader.read('file.txt'), retained, 'closed tabs release cached text')
  await symlink(path, join(root, 'link.txt'))
  assert.equal((await reader.read('link.txt')).disk, 'recreated\n')
  await unlink(join(root, 'link.txt'))
  await writeFile(join(outside, 'file.txt'), 'outside\n')
  await symlink(join(outside, 'file.txt'), join(root, 'link.txt'))
  await assert.rejects(reader.read('link.txt'), /outside the workspace/)
  console.log(`Editor disk reader smoke passed; 20 unchanged 1 MB polls: cached ${cachedMs.toFixed(1)}ms, raw reads ${rawMs.toFixed(1)}ms`)
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}
