import { NextResponse } from 'next/server'
import { executeExternalCoordinatorAction } from '@/lib/agentCoordinationExternal'
import { EXTERNAL_COORD_PROTOCOL_VERSION } from '@/lib/agentProtocol'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'JSON body is required' }, { status: 400 })
  try {
    const result = await executeExternalCoordinatorAction(body)
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Agent-Viewer-Coord-Protocol': String(EXTERNAL_COORD_PROTOCOL_VERSION),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Coordinator action failed'
    const status = /capability/i.test(message) ? 403 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
