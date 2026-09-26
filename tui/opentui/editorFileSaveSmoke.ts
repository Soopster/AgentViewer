import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EditorDiskConflictError, saveEditorFileSafely } from './editorFileSave'
import { EditorEncodingError } from './editorLineEndings'

const root = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-save-'))
const outside = await mkdtemp(join(tmpdir(), 'agent-viewer-editor-save-outside-'))
const path = join(root, 'safe.ts')
try {
  await writeFile(path, 'const value = 1\n', 'utf8')
  await chmod(path, 0o640)
  await saveEditorFileSafely(root, 'safe.ts', 'const value = 2\n', 'const value = 1\n')
  if (await readFile(path, 'utf8') !== 'const value = 2\n' || ((await stat(path)).mode & 0o777) !== 0o640) {
    throw new Error('Atomic save did not preserve content and file mode')
  }

  await writeFile(path, 'const external = 3\n', 'utf8')
  let conflict: unknown
  try { await saveEditorFileSafely(root, 'safe.ts', 'const stale = 4\n', 'const value = 2\n') } catch (error) { conflict = error }
  if (!(conflict instanceof EditorDiskConflictError) || await readFile(path, 'utf8') !== 'const external = 3\n') {
    throw new Error(`External edit was not protected from a stale save: ${String(conflict)}`)
  }

  const linkedTarget = join(root, 'linked-target.ts')
  const linkedPath = join(root, 'linked.ts')
  await writeFile(linkedTarget, 'const linked = 1\n', 'utf8')
  await symlink(linkedTarget, linkedPath)
  await saveEditorFileSafely(root, 'linked.ts', 'const linked = 2\n', 'const linked = 1\n')
  if (!(await lstat(linkedPath)).isSymbolicLink() || await readFile(linkedTarget, 'utf8') !== 'const linked = 2\n') {
    throw new Error('Safe save replaced an internal symlink instead of its workspace target')
  }

  const outsideTarget = join(outside, 'outside.ts')
  await writeFile(outsideTarget, 'const outside = 1\n', 'utf8')
  await symlink(outsideTarget, join(root, 'outside-link.ts'))
  let outsideRejected = false
  try { await saveEditorFileSafely(root, 'outside-link.ts', 'const outside = 2\n', 'const outside = 1\n') } catch { outsideRejected = true }
  if (!outsideRejected || await readFile(outsideTarget, 'utf8') !== 'const outside = 1\n') {
    throw new Error('Safe save followed a symbolic link outside the workspace')
  }

  // A mode with bits the umask clears. `open(path, 'wx', mode)` is masked, so
  // handing it the original mode silently narrowed the file: under the usual
  // 0o022 a group- and world-writable file came back 0o644.
  const groupWritable = join(root, 'group-writable.sh')
  await writeFile(groupWritable, '#!/bin/sh\necho one\n', 'utf8')
  await chmod(groupWritable, 0o777)
  await saveEditorFileSafely(root, 'group-writable.sh', '#!/bin/sh\necho two\n', '#!/bin/sh\necho one\n')
  const savedMode = (await stat(groupWritable)).mode & 0o777
  if (savedMode !== 0o777) {
    throw new Error(`Save narrowed the file mode through the umask: 0o${savedMode.toString(8)} (umask 0o${process.umask().toString(8)})`)
  }

  // Encoding. `readFile(path, 'utf8')` reports no error for bytes that are not
  // UTF-8, it substitutes U+FFFD — so a Latin-1 file opened, looked plausible,
  // and the first save rewrote its own bytes as the replacement character.
  const latin1 = join(root, 'latin1.txt')
  const latin1Bytes = Buffer.from([0x63, 0x61, 0x66, 0xE9, 0x0A])
  await writeFile(latin1, latin1Bytes)
  let encodingRejected: unknown
  try { await saveEditorFileSafely(root, 'latin1.txt', 'caf�\n', 'caf�\n') } catch (error) { encodingRejected = error }
  if (!(encodingRejected instanceof EditorEncodingError) || !Buffer.from(await readFile(latin1)).equals(latin1Bytes)) {
    throw new Error(`A non-UTF-8 file was not refused and may have been rewritten lossily: ${String(encodingRejected)}`)
  }

  const binary = join(root, 'binary.dat')
  const binaryBytes = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x0A])
  await writeFile(binary, binaryBytes)
  let binaryRejected: unknown
  try { await saveEditorFileSafely(root, 'binary.dat', 'PK\0\0\n', 'PK\0\0\n') } catch (error) { binaryRejected = error }
  if (!(binaryRejected instanceof EditorEncodingError) || !Buffer.from(await readFile(binary)).equals(binaryBytes)) {
    throw new Error(`A file containing NUL bytes was not refused: ${String(binaryRejected)}`)
  }

  // A BOM is a character the editor holds and writes back, not something it
  // consumes: the file has to come out of a save as the same three leading
  // bytes it went in with, CRLF endings included.
  const bomPath = join(root, 'bom.txt')
  const bomBytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('one\r\ntwo\r\n', 'utf8')])
  await writeFile(bomPath, bomBytes)
  // The mark is a property of the file, not a character in the buffer: the
  // terminal edit buffer silently drops a leading U+FEFF, so carrying it in the
  // content made every BOM'd file look like the buffer had refused it.
  await saveEditorFileSafely(root, 'bom.txt', 'one\ntwo\nthree\n', 'one\ntwo\n', '\r\n', true)
  const bomSaved = Buffer.from(await readFile(bomPath))
  const bomExpected = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('one\r\ntwo\r\nthree\r\n', 'utf8')])
  if (!bomSaved.equals(bomExpected)) {
    throw new Error(`A byte-order mark or CRLF ending did not survive the save: ${bomSaved.toString('hex')}`)
  }

  // Astral characters and combining marks are ordinary UTF-8 and must not be
  // caught by the refusal above.
  const unicodePath = join(root, 'unicode.txt')
  await writeFile(unicodePath, 'a\n', 'utf8')
  await saveEditorFileSafely(root, 'unicode.txt', '🙂 é 日本\n', 'a\n')
  if (await readFile(unicodePath, 'utf8') !== '🙂 é 日本\n') throw new Error('Valid non-ASCII UTF-8 was mangled')

  console.log('Editor durable atomic save/external-conflict/mode/encoding smoke passed')
} finally {
  await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
}
