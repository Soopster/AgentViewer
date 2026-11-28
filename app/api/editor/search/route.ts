import { execFile } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Project-wide search for the Web editor: `git grep` over the working tree
// (tracked and untracked, ignored files excluded), a fixed string, no shell.
const MAX_RESULTS = 300
const MAX_LINE = 400

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = params.get('cwd') ?? ''
  const query = params.get('q') ?? ''
  if (!cwd || !isAbsolute(cwd)) return NextResponse.json({ error: 'An absolute cwd is required' }, { status: 400 })
  if (!query.trim() || query.includes('\0')) return NextResponse.json({ results: [], truncated: false })
  const caseSensitive = params.get('case') === '1'
  const args = ['grep', '-n', '-I', '--no-color', '--untracked', '-F', ...(caseSensitive ? [] : ['-i']), '-e', query, '--', '.']
  const stdout = await new Promise<string>((done) => {
    execFile('git', args, { cwd: resolve(cwd), maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }, (error, out) => {
      // Exit 1 is "no matches"; anything else with no output is a failure we report as none.
      done(typeof out === 'string' ? out : String(out ?? ''))
      void error
    })
  })
  const results: { path: string; line: number; text: string }[] = []
  for (const row of stdout.split('\n')) {
    const match = /^(.*?):(\d+):(.*)$/.exec(row)
    if (!match) continue
    results.push({ path: match[1]!, line: Number(match[2]), text: match[3]!.slice(0, MAX_LINE) })
    if (results.length >= MAX_RESULTS) break
  }
  return NextResponse.json({ results, truncated: results.length >= MAX_RESULTS })
}
