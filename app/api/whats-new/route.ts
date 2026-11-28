import { NextResponse } from 'next/server'

// The highlights of this server's repository, revision by revision, for the Web
// What's new plugin. It always reads the server's own working repository.
export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('limit'))
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 60) : undefined
  try {
    const { readWhatsNew } = await import('@/lib/whatsNewReader')
    return NextResponse.json(await readWhatsNew({ limit }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not read the history' }, { status: 500 })
  }
}
