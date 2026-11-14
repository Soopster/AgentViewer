import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_EDITABLE_BYTES = 2 * 1024 * 1024

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function resolveEditablePath(cwd: string, path: string): string {
  if (!cwd || !isAbsolute(cwd)) throw new Error('An absolute cwd is required')
  if (!path || path.includes('\0') || isAbsolute(path)) throw new Error('A relative path is required')
  const root = resolve(/* turbopackIgnore: true */ cwd)
  const target = resolve(/* turbopackIgnore: true */ root, path)
  if (target !== root && !target.startsWith(root + sep)) throw new Error('Path escapes the workspace')
  return target
}

// runGitCommand trims trailing newlines, which would surface as a phantom
// end-of-file change in every diff — read HEAD content verbatim instead.
function readHeadContent(cwd: string, path: string): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['show', `HEAD:${path.split(sep).join('/')}`], {
      cwd,
      encoding: 'buffer',
      maxBuffer: MAX_EDITABLE_BYTES,
    }, (err, stdout) => {
      if (err) {
        done(null)
        return
      }
      const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''), 'utf-8')
      done(buffer.includes(0) ? null : buffer.toString('utf-8'))
    })
  })
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get('cwd') ?? ''
    const path = request.nextUrl.searchParams.get('path') ?? ''
    const target = resolveEditablePath(cwd, path)

    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    if (info.size > MAX_EDITABLE_BYTES) {
      return NextResponse.json({ error: 'File is too large to edit inline' }, { status: 413 })
    }

    const buffer = await readFile(target)
    if (buffer.includes(0)) {
      return NextResponse.json({ error: 'File appears to be binary' }, { status: 415 })
    }
    const content = buffer.toString('utf-8')
    const headContent = await readHeadContent(cwd, path)
    return NextResponse.json({ content, headContent, sha256: contentHash(content) })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 })
  }
}

type SaveRequestBody = {
  cwd?: string
  path?: string
  content?: string
  expectedSha256?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SaveRequestBody
    if (typeof body.content !== 'string' || typeof body.expectedSha256 !== 'string') {
      return NextResponse.json({ error: 'content and expectedSha256 are required' }, { status: 400 })
    }
    if (Buffer.byteLength(body.content, 'utf-8') > MAX_EDITABLE_BYTES) {
      return NextResponse.json({ error: 'Content is too large to save inline' }, { status: 413 })
    }
    const target = resolveEditablePath(body.cwd ?? '', body.path ?? '')

    const current = await readFile(target, 'utf-8').catch(() => null)
    if (current === null) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    if (contentHash(current) !== body.expectedSha256) {
      return NextResponse.json({ error: 'File changed on disk since it was loaded' }, { status: 409 })
    }

    await writeFile(target, body.content, 'utf-8')
    return NextResponse.json({ sha256: contentHash(body.content) })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 })
  }
}
