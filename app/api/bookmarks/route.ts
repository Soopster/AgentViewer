import { NextResponse } from 'next/server'
import { listAllBookmarks } from '@/lib/messageBookmarks'

export async function GET() {
  try {
    const bookmarks = await listAllBookmarks()
    return NextResponse.json({ bookmarks })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
