import { NextResponse } from 'next/server'
import { nativeFocus } from '@/lib/focus/service'
import type { FocusHeldItem } from '@/lib/plugins/focusMode'
export const runtime = 'nodejs'

const fail = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
const isHeldItem = (value: unknown): value is FocusHeldItem => {
  const item = value as FocusHeldItem
  return !!item && typeof item.id === 'string' && typeof item.at === 'number' && typeof item.title === 'string' && ['toast', 'notice', 'desktop'].includes(item.channel)
}

export async function GET() {
  try { return NextResponse.json({ result: await nativeFocus.read() }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return fail(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    let result: unknown
    if (body?.action === 'start' && typeof body.minutes === 'number') result = await nativeFocus.start(body.minutes)
    else if (body?.action === 'end') result = await nativeFocus.end()
    else if (body?.action === 'clear-digest') result = await nativeFocus.clearDigest()
    else if (body?.action === 'hold' && Array.isArray(body.items)) {
      const items = body.items.filter(isHeldItem).slice(0, 50).map((item: FocusHeldItem) => ({ ...item, title: item.title.slice(0, 300), detail: item.detail?.slice(0, 1000) }))
      result = await nativeFocus.hold(items)
    } else throw new Error('Unknown Focus operation')
    return NextResponse.json({ result: result ?? null })
  } catch (error) { return fail(error) }
}
