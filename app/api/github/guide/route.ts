import { NextRequest, NextResponse } from 'next/server'
import { githubError, readGithubCwd } from '@/lib/github/cwd'
import { isWritingPrGuide, readPrGuide, writePrGuide } from '@/lib/github/guideService'

export const maxDuration = 300

const numberOf = (value: unknown) => { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null }

/** GET ?cwd&number → { guide, writing }. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const cwd = readGithubCwd(params.get('cwd'))
  const number = numberOf(params.get('number'))
  if (!cwd || !number) return NextResponse.json({ error: 'cwd and number are required' }, { status: 400 })
  return NextResponse.json({ guide: await readPrGuide(cwd, number), writing: isWritingPrGuide(cwd, number) })
}

/** POST { cwd, number } writes (or rewrites) the guide. It spends model usage. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { cwd?: unknown; number?: unknown }
  const cwd = readGithubCwd(body.cwd)
  const number = numberOf(body.number)
  if (!cwd || !number) return NextResponse.json({ error: 'cwd and number are required' }, { status: 400 })
  try {
    return NextResponse.json({ guide: await writePrGuide(cwd, number) })
  } catch (error) { return githubError(error) }
}
