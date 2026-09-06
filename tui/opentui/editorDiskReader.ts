import { readFile, stat } from 'node:fs/promises'
import { resolveSafeEditorFile } from './editorFileOperations'
import { detectEditorLineEnding, normalizeEditorNewlines, type EditorLineEnding } from './editorLineEndings'

type Reading = { disk: string; lineEnding: EditorLineEnding }

/** One cache per editor; closed tabs release their cached text on the next poll. */
export function createEditorDiskReader(root: string) {
  const cache = new Map<string, { signature: string; reading: Reading }>()
  const signature = async (absolute: string) => {
    const info = await stat(absolute, { bigint: true })
    return `${absolute}:${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
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
        const before = await signature(absolute)
        const cached = cache.get(path)
        if (cached?.signature === before) return cached.reading
        const raw = await readFile(absolute, 'utf8')
        const reading = { disk: normalizeEditorNewlines(raw), lineEnding: detectEditorLineEnding(raw) }
        // Never cache a read that overlapped a write or atomic replacement.
        if (before === await signature(absolute)) cache.set(path, { signature: before, reading })
        else cache.delete(path)
        return reading
      } catch (error) {
        cache.delete(path)
        throw error
      }
    },
  }
}
