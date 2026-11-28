import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export type ProjectFileEntry = {
  path: string
  basename: string
}

const CACHE_TTL_MS = 5_000
// Each entry can hold thousands of ProjectFileEntry records (FALLBACK_MAX_ENTRIES
// = 5 000). Cap the number of distinct cwds we remember at once so a developer
// browsing several projects in one session can't accumulate hundreds of MB of
// stale filename arrays.
const CACHE_MAX_ENTRIES = 8
const cache = new Map<string, { at: number; entries: ProjectFileEntry[] }>()

function rememberProjectFileEntries(cwd: string, entries: ProjectFileEntry[]): void {
  if (cache.has(cwd)) cache.delete(cwd)
  cache.set(cwd, { at: Date.now(), entries })
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const FALLBACK_IGNORE = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.svelte-kit',
  '.agent-viewer-data',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
])

const FALLBACK_MAX_ENTRIES = 5_000

export async function listProjectFiles(
  cwd: string,
  runGit: (cwd: string, args: string[]) => Promise<string>,
): Promise<ProjectFileEntry[]> {
  const cached = cache.get(cwd)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    rememberProjectFileEntries(cwd, cached.entries)
    return cached.entries
  }

  const gitEntries = await tryGitListing(cwd, runGit)
  const entries = gitEntries.length > 0 ? gitEntries : await fallbackWalk(cwd)
  rememberProjectFileEntries(cwd, entries)
  return entries
}

async function tryGitListing(
  cwd: string,
  runGit: (cwd: string, args: string[]) => Promise<string>,
): Promise<ProjectFileEntry[]> {
  try {
    const stdout = await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard'])
    if (!stdout) return []
    const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    return lines.map((path) => ({ path, basename: basename(path) }))
  } catch {
    return []
  }
}

async function fallbackWalk(root: string): Promise<ProjectFileEntry[]> {
  const out: ProjectFileEntry[] = []
  const stack: string[] = [root]
  while (stack.length > 0 && out.length < FALLBACK_MAX_ENTRIES) {
    const dir = stack.pop()!
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (FALLBACK_IGNORE.has(dirent.name)) continue
      if (dirent.name.startsWith('.') && FALLBACK_IGNORE.has(dirent.name)) continue
      const full = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!dirent.isFile()) continue
      const rel = relative(root, full).split(sep).join('/')
      if (!rel) continue
      out.push({ path: rel, basename: dirent.name })
      if (out.length >= FALLBACK_MAX_ENTRIES) break
    }
  }
  return out
}

function basename(value: string): string {
  const norm = value.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  return idx === -1 ? norm : norm.slice(idx + 1)
}
