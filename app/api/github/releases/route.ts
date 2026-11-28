import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { createGithubRelease, fetchGithubRelease, fetchGithubReleases } from '@/lib/github/releases'
import type { GithubReleaseCreate } from '@/lib/github/types'

/** GET ?cwd → releases; GET ?cwd&tag → one release. POST { cwd, release } creates one. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = readGithubCwd(params.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    const tag = params.get('tag')
    if (tag) return NextResponse.json({ release: await fetchGithubRelease(cwd, tag) })
    return NextResponse.json({ releases: await fetchGithubReleases(cwd) })
  } catch (error) { return githubError(error) }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; release?: GithubReleaseCreate }
  const cwd = readGithubCwd(body.cwd)
  if (!cwd || !body.release || typeof body.release.tag !== 'string') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  try { return NextResponse.json({ url: await createGithubRelease(cwd, body.release) }) } catch (error) { return githubError(error, 400) }
}
