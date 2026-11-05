import { NextRequest, NextResponse } from 'next/server'
import { listReviews, mutateReview, readReviewIfChanged } from '@/lib/review/store'
import { reviewRequestSchema } from '@/lib/review/schema'
import { refreshReview } from '@/lib/review/refresh'

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
    const result = body.publish?.refresh
      ? await refreshReview({ cwd: body.cwd, source: body.source, requestId: body.requestId, viewId: body.publish.viewId })
      : await mutateReview(body)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }) }
}
