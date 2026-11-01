import path from 'node:path'

/** `cwd` arrives from a client; `gh` runs in it, so it must at least be an absolute path. */
export function readGithubCwd(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value) ? value : null
}

import { NextResponse } from 'next/server'

/** Shared tail of the GitHub routes: a failure becomes `{ error }` with a status. */
export function githubError(error: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status })
}
