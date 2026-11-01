import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { markAllGithubNotificationsRead, markGithubNotificationRead } from '@/lib/github/inbox'

/** POST { cwd, id } marks one thread read; { cwd, all: true } marks everything read. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; id?: unknown; all?: unknown }
  const cwd = readGithubCwd(body.cwd)
  if (!cwd || (body.all !== true && typeof body.id !== 'string')) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  try {
    if (body.all === true) await markAllGithubNotificationsRead(cwd)
    else await markGithubNotificationRead(cwd, body.id as string)
    return NextResponse.json({ ok: true })
  } catch (error) { return githubError(error, 400) }
}
