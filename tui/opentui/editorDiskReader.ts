import { readFile, stat } from 'node:fs/promises'
import { resolveSafeEditorFile } from './editorFileOperations'
import { decodeEditorFileText, detectEditorLineEnding, normalizeEditorNewlines, type EditorLineEnding } from './editorLineEndings'

type Reading = { disk: string; lineEnding: EditorLineEnding }

// A timestamp only proves a file is unchanged once it is far enough in the past
// that the filesystem could not have recorded a later write with the same value.
// APFS records nanoseconds, but ext4 with 128-byte inodes and every FAT volume
// record whole seconds (FAT: two), so an in-place, same-size write landing in
// the same tick as our read is invisible to `dev:ino:size:mtime:ctime` — and
// stays invisible on every later poll, because the signature never moves again.
// Git calls this a racily-clean entry and resolves it the same way: a stamp that
// is not strictly older than the observation is not trusted.
const COARSE_TIMESTAMP_MS = 2_000

export type EditorFileStamp = {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  mtimeMs: number
}

/**
 * The development machine's filesystem (APFS) records nanoseconds, so the
 * coarse-granularity case cannot be reached by writing files. It is reached by
 * injecting a stamp source that truncates the way ext4 and FAT do.
 */
export type EditorDiskReaderOptions = { stamp?: (absolute: string) => Promise<EditorFileStamp> }

async function statStamp(absolute: string): Promise<EditorFileStamp> {
  const info = await stat(absolute, { bigint: true })
  return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs, mtimeMs: Number(info.mtimeMs) }
}

/** One cache per editor; closed tabs release their cached text on the next poll. */
export function createEditorDiskReader(root: string, options: EditorDiskReaderOptions = {}) {
  const cache = new Map<string, { signature: string; mtimeMs: number; reading: Reading }>()
  const stamp = options.stamp ?? statStamp
  const describe = async (absolute: string) => {
    const info = await stamp(absolute)
    return {
      signature: `${absolute}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
      mtimeMs: info.mtimeMs,
    }
  }
  return {
    retain(paths: Iterable<string>) {
      const retained = new Set(paths)
      for (const path of cache.keys()) if (!retained.has(path)) cache.delete(path)
    },
    async read(path: string): Promise<Reading> {
      try {
        // Validate even cache hits: a symlink may have been retargeted.
        const { absolute } = await resolveSafeEditorFile(root, path)
        const before = await describe(absolute)
        const cached = cache.get(path)
        const settled = Date.now() - before.mtimeMs > COARSE_TIMESTAMP_MS
        if (cached?.signature === before.signature && settled) return cached.reading
        // Read bytes, not a lossy 'utf8' string: a file the editor cannot
        // represent is refused rather than shown with U+FFFD where its own
        // bytes were, which is what a later save would then write back.
        const raw = decodeEditorFileText(await readFile(absolute), path)
        const reading = { disk: normalizeEditorNewlines(raw), lineEnding: detectEditorLineEnding(raw) }
        // Never cache a read that overlapped a write or atomic replacement, and
        // never cache against a timestamp too fresh to distinguish writes by.
        if (settled && before.signature === (await describe(absolute)).signature) cache.set(path, { ...before, reading })
        else cache.delete(path)
        return reading
      } catch (error) {
        cache.delete(path)
        throw error
      }
    },
  }
}
