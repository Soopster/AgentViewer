import { NextRequest, NextResponse } from 'next/server'
import { listReviews, mutateReview, readReviewIfChanged } from '@/lib/review/store'
import { reviewRequestSchema } from '@/lib/review/schema'
import { fetchGitData, parseGitDiffSource } from '@/lib/gitProvider'
import { fetchSourceStatus } from '@/lib/gitDiffSources'
import { runGitCommand } from '@/lib/gitNodeProvider'
import { fetchGitReviewStream } from '@/lib/review/gitStream'

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get('cwd')
    if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
    const source = request.nextUrl.searchParams.get('source')
    const after = request.nextUrl.searchParams.get('after')
    const result = source ? await readReviewIfChanged(cwd, source, after ? Number(after) : undefined) : { reviews: await listReviews(cwd) }
    return result === null ? new NextResponse(null, { status: 204 }) : NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }) }
}

export async function POST(request: NextRequest) {
  try {
    const body = reviewRequestSchema.parse(await request.json())
    if (body.publish?.refresh) {
      if (!/^(working|branch|turn:)/.test(body.source)) throw new Error('This source must publish its own patch')
      const [kind, sha] = body.source.split(':')
      const source = parseGitDiffSource(kind, sha)
      const entries = source.kind === 'working'
        ? (await fetchGitData(body.cwd, runGitCommand)).status
        : await fetchSourceStatus(body.cwd, runGitCommand, source)
      body.publish.patch = await fetchGitReviewStream(body.cwd, runGitCommand, source, entries)
    }
    return NextResponse.json(await mutateReview(body), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) }
}
