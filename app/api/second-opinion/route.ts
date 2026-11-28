import { NextResponse } from 'next/server'
import { nativeSecondOpinion } from '@/lib/secondOpinion/service'
import { SECOND_OPINION_REVIEWERS, type SecondOpinionReviewer } from '@/lib/secondOpinion/review'
export const runtime = 'nodejs'

const fail = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })

export async function GET(request: Request) {
  const cwd = new URL(request.url).searchParams.get('cwd')
  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  try {
    return NextResponse.json({ result: await nativeSecondOpinion.read(cwd, request.signal) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return fail(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body || typeof body.cwd !== 'string') throw new Error('cwd is required')
    const reviewer = SECOND_OPINION_REVIEWERS.includes(body.reviewer) ? body.reviewer as SecondOpinionReviewer : undefined
    let result: unknown
    if (body.action === 'start' && typeof body.checkpointSha === 'string') {
      result = await nativeSecondOpinion.start(body.cwd, { checkpointSha: body.checkpointSha, reviewer, instructions: typeof body.instructions === 'string' ? body.instructions : undefined })
    } else if (body.action === 'cancel' && typeof body.id === 'string') result = await nativeSecondOpinion.cancel(body.cwd, body.id)
    else if (body.action === 'dismiss' && typeof body.id === 'string' && typeof body.findingId === 'string') result = await nativeSecondOpinion.dismiss(body.cwd, body.id, body.findingId)
    else if (body.action === 'configure' && body.settings && typeof body.settings === 'object') result = await nativeSecondOpinion.configure(body.cwd, body.settings)
    else throw new Error('Unknown Second Opinion operation')
    return NextResponse.json({ result: result ?? null })
  } catch (error) { return fail(error) }
}
