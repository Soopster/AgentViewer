import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
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
  // Age the file past the coarse-timestamp window before measuring the cache:
  // a stamp inside it is not trustworthy enough to skip a read (see below).
  const aged = new Date(Date.now() - 60_000)
  await utimes(path, aged, aged)
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

  // Bytes that are not UTF-8 must not reach the buffer as U+FFFD: the reader
  // refuses the file rather than showing text a later save would write back
  // over the file's own bytes.
  const latin1 = join(root, 'latin1.txt')
  await writeFile(latin1, Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0A]))
  await assert.rejects(reader.read('latin1.txt'), /valid UTF-8/)
  await writeFile(join(root, 'binary.dat'), Buffer.from([0x61, 0x00, 0x62, 0x0A]))
  await assert.rejects(reader.read('binary.dat'), /NUL bytes/)
  // A BOM stays in the text as U+FEFF so it survives the round trip to disk.
  await writeFile(join(root, 'bom.txt'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('hello\r\n')]))
  const bom = await reader.read('bom.txt')
  assert.equal(bom.disk, '\uFEFFhello\n')
  assert.equal(bom.lineEnding, '\r\n')

  // A filesystem whose timestamps are whole seconds — ext4 with 128-byte inodes,
  // every FAT volume — cannot distinguish a write that lands in the same second
  // as the read that preceded it. Neither mtime, ctime nor size moves, so the
  // signature never moves again either and the cache is stale forever, not for
  // one poll. APFS records nanoseconds, so this is only reachable by injecting
  // the coarse stamp source.
  const coarse = createEditorDiskReader(root, {
    async stamp(absolute) {
      const info = await stat(absolute, { bigint: true })
      // BigInt(…) rather than an `n` literal: this file is inside the web
      // tsconfig's program too, and that target predates BigInt literals.
      const nanosecondsPerSecond = BigInt(1_000_000_000)
      const seconds = info.mtimeNs / nanosecondsPerSecond * nanosecondsPerSecond
      return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: seconds, ctimeNs: seconds, mtimeMs: Number(seconds / BigInt(1_000_000)) }
    },
  })
  const racy = join(root, 'racy.txt')
  await writeFile(racy, 'one\n')
  assert.equal((await coarse.read('racy.txt')).disk, 'one\n')
  // Same length, same second, written in place: indistinguishable to the stamp.
  const handle = await open(racy, 'r+')
  try { await handle.write('six', 0) } finally { await handle.close() }
  const sameSecond = new Date(Math.floor(Date.now() / 1000) * 1000)
  await utimes(racy, sameSecond, sameSecond)
  assert.equal((await coarse.read('racy.txt')).disk, 'six\n', 'a racily-clean timestamp is not trusted as proof of no change')
  assert.equal((await coarse.read('racy.txt')).disk, 'six\n', 'and still is not on the next poll')
  console.log(`Editor disk reader smoke passed; 20 unchanged 1 MB polls: cached ${cachedMs.toFixed(1)}ms, raw reads ${rawMs.toFixed(1)}ms`)
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}
