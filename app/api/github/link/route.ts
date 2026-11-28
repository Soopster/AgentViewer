import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { fetchGithubLinkPreview, readCheckoutRepo } from '@/lib/github/preview'

/** GET ?cwd → { repo } for the checkout; GET ?cwd&url → { preview } of a pull request or issue link. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = readGithubCwd(params.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    const url = params.get('url')
    if (url) return NextResponse.json({ preview: await fetchGithubLinkPreview(cwd, url) })
    return NextResponse.json({ repo: await readCheckoutRepo(cwd) })
  } catch (error) { return githubError(error) }
}
