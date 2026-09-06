import { open, readdir, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import type { NextRequest } from 'next/server'
import { runGitCommand } from '@/lib/gitNodeProvider'
import { listProjectFiles, type ProjectFileEntry } from '@/lib/projectFiles'
import { runViewSessionAction } from '@/lib/sessionBackend'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_DIRECTORY_ENTRIES = 2_000
const MAX_PREVIEW_BYTES = 512 * 1024
const MAX_SEARCH_RESULTS = 30
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.css', '.csv', '.env', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json',
  '.jsx', '.log', '.lua', '.md', '.mjs', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts',
  '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml', '.zsh',
])

type FileEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modified: number
}

async function readDirectory(path: string, showHidden: boolean): Promise<{ entries: FileEntry[]; truncated: boolean }> {
  const dirents = await readdir(path, { withFileTypes: true })
  const visible = showHidden ? dirents : dirents.filter((entry) => !entry.name.startsWith('.'))
  const sliced = visible.slice(0, MAX_DIRECTORY_ENTRIES)
  const entries = await Promise.all(sliced.map(async (entry): Promise<FileEntry> => {
    const entryPath = join(path, entry.name)
    const info = await stat(entryPath).catch(() => null)
    return {
      name: entry.name,
      path: entryPath,
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other',
      size: info?.size ?? 0,
      modified: info?.mtimeMs ?? 0,
    }
  }))
  return { entries, truncated: visible.length > sliced.length }
}

function requestedPath(request: NextRequest): string {
  const raw = request.nextUrl.searchParams.get('path')?.trim()
  if (!raw || raw.includes('\0')) throw new Error('A valid path is required')
  return isAbsolute(raw)
    ? resolve(/* turbopackIgnore: true */ raw)
    : resolve(/* turbopackIgnore: true */ process.cwd(), raw)
}

export async function GET(request: NextRequest) {
  const cwd = request.nextUrl.searchParams.get('cwd')
  if (cwd) {
    try {
      const query = (request.nextUrl.searchParams.get('q') ?? '').toLowerCase()
      const files = await listProjectFiles(cwd, runGitCommand)
      return Response.json({ files: scoreAndFilter(files, query, MAX_SEARCH_RESULTS), total: files.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 500 })
    }
  }

  try {
    const path = requestedPath(request)
    const showHidden = request.nextUrl.searchParams.get('hidden') === '1'
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim()
    const provider = request.nextUrl.searchParams.get('provider')
    const info = await stat(path).catch(() => null)

    if (sessionId && provider === 'claude' && !info?.isDirectory()) {
      const result = await runViewSessionAction({
        sessionId,
        provider: 'claude',
        body: { action: 'readFile', path, maxBytes: MAX_PREVIEW_BYTES, encoding: 'utf-8' },
      })
      const file = result.file && typeof result.file === 'object' ? result.file as Record<string, unknown> : null
      if (file && typeof file.contents === 'string') {
        return Response.json({
          kind: 'text',
          path: typeof file.absPath === 'string' ? file.absPath : path,
          size: Buffer.byteLength(file.contents, 'utf8'),
          content: file.contents,
          truncated: file.truncated === true,
          remote: true,
        })
      }
    }

    if (!info) throw new Error('Path was not found locally or in the Claude session filesystem')

    if (info.isDirectory()) {
      const [{ entries, truncated }, parentResult] = await Promise.all([
        readDirectory(path, showHidden),
        dirname(path) === path ? Promise.resolve({ entries: [] as FileEntry[] }) : readDirectory(dirname(path), showHidden),
      ])
      return Response.json({
        kind: 'directory',
        path,
        parent: dirname(path),
        entries,
        parentEntries: parentResult.entries,
        truncated,
      })
    }

    if (!info.isFile()) {
      return Response.json({ kind: 'binary', path, size: info.size, extension: 'special file' })
    }

    const handle = await open(path, 'r')
    const buffer = Buffer.alloc(Math.min(info.size, MAX_PREVIEW_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0).finally(() => handle.close())
    const content = buffer.subarray(0, bytesRead)
    const extension = extname(path).toLowerCase()
    const looksBinary = !TEXT_EXTENSIONS.has(extension) && content.subarray(0, 8_192).includes(0)
    if (looksBinary) {
      return Response.json({ kind: 'binary', path, size: info.size, extension: extension.slice(1) || 'binary' })
    }

    return Response.json({
      kind: 'text',
      path,
      size: info.size,
      content: content.toString('utf8'),
      truncated: info.size > MAX_PREVIEW_BYTES,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read path'
    return Response.json({ error: message }, { status: 400 })
  }
}

function scoreAndFilter(entries: ProjectFileEntry[], query: string, limit: number): ProjectFileEntry[] {
  if (!query) return entries.slice(0, limit)
  const scored: Array<{ entry: ProjectFileEntry; score: number }> = []
  for (const entry of entries) {
    const path = entry.path.toLowerCase()
    const basename = entry.basename.toLowerCase()
    const score = scoreMatch(path, basename, query)
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((row) => row.entry)
}

function scoreMatch(path: string, basename: string, query: string): number {
  if (basename === query) return 1000
  if (basename.startsWith(query)) return 800
  if (path.endsWith(query)) return 700
  if (basename.includes(query)) return 500
  if (path.includes(query)) return 300
  let queryIndex = 0
  for (let index = 0; index < path.length && queryIndex < query.length; index += 1) {
    if (path[index] === query[queryIndex]) queryIndex += 1
  }
  return queryIndex === query.length ? 100 + Math.max(0, 60 - path.length) : 0
}
