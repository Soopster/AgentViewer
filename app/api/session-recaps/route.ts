import { NextResponse } from 'next/server'
import { ensureSessionRecapEngine } from '@/lib/sessionRecapEngine'
import { readSessionRecapsEnabled, setSessionRecapsEnabled } from '@/lib/sessionRecapStore'

/**
 * The switch for idle recaps. Off by default: a recap sends transcript text to
 * a model.
 *
 *   GET  → { enabled }
 *   POST → { enabled }   body: { enabled: boolean }
 */
export async function GET() {
  const enabled = await readSessionRecapsEnabled()
  if (enabled) ensureSessionRecapEngine()
  return NextResponse.json({ enabled })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }
  const enabled = await setSessionRecapsEnabled(body.enabled)
  if (enabled) ensureSessionRecapEngine()
  return NextResponse.json({ enabled })
}
