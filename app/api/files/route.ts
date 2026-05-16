import { NextRequest, NextResponse } from 'next/server'
import { runGitCommand } from '@/lib/gitNodeProvider'
import { listProjectFiles, type ProjectFileEntry } from '@/lib/projectFiles'

export const maxDuration = 10

const MAX_RESULTS = 30

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const cwd = params.get('cwd')
  const query = (params.get('q') ?? '').toLowerCase()

  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  }

  try {
    const files = await listProjectFiles(cwd, runGitCommand)
    const filtered = scoreAndFilter(files, query, MAX_RESULTS)
    return NextResponse.json({ files: filtered, total: files.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function scoreAndFilter(entries: ProjectFileEntry[], query: string, limit: number): ProjectFileEntry[] {
  if (!query) {
    return entries.slice(0, limit)
  }
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

  let qi = 0
  for (let i = 0; i < path.length && qi < query.length; i += 1) {
    if (path[i] === query[qi]) qi += 1
  }
  return qi === query.length ? 100 + Math.max(0, 60 - path.length) : 0
}
