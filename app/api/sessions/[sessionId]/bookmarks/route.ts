import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { getSessionBookmarks, setMessageBookmark } from '@/lib/messageBookmarks'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const providerParam = searchParams.get('provider')
  const provider = isAgentProvider(providerParam) ? providerParam : undefined

  try {
    const bookmarks = await getSessionBookmarks(provider, sessionId)
    return NextResponse.json({
      sessionId,
      provider,
      bookmarks,
      ids: bookmarks.map((bookmark) => bookmark.uuid),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const body = await request.json().catch(() => ({}))
  const provider = isAgentProvider(body?.provider) ? body.provider : undefined
  const uuid = typeof body?.uuid === 'string' ? body.uuid : ''
  const bookmarked = body?.bookmarked !== false
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : undefined

  if (!uuid) {
    return NextResponse.json({ error: 'Missing message uuid' }, { status: 400 })
  }

  try {
    const bookmarks = await setMessageBookmark({ provider, sessionId, uuid, bookmarked, meta })
    return NextResponse.json({
      sessionId,
      provider,
      bookmarks,
      ids: bookmarks.map((bookmark) => bookmark.uuid),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
