import { NextRequest, NextResponse } from 'next/server'
import { fetchGithubInbox } from '@/lib/github/inbox'
import { readGithubCwd } from '@/lib/github/cwd'

/** GET ?cwd=<abs path> → GithubInbox. Read-only; cached for 30s. */
export async function GET(request: NextRequest) {
  const cwd = readGithubCwd(request.nextUrl.searchParams.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try {
    return NextResponse.json({ inbox: await fetchGithubInbox(cwd) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
