import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { fetchGithubSecurity } from '@/lib/github/security'

/** GET ?cwd → open Dependabot, code-scanning and secret-scanning alerts, and which of them the repo has off. */
export async function GET(request: NextRequest) {
  const cwd = readGithubCwd(request.nextUrl.searchParams.get('cwd'))
  if (!cwd) return NextResponse.json({ error: 'Invalid working directory.' }, { status: 400 })
  try { return NextResponse.json({ security: await fetchGithubSecurity(cwd) }) } catch (error) { return githubError(error) }
}
