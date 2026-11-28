import { NextRequest, NextResponse } from 'next/server'
import { readClaudePlanLimits } from '@/lib/claudePlanLimits'

/** Claude plan windows for the composer strip. Read only through a warm session: it never spawns a CLI. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  const instance = new URL(request.url).searchParams.get('providerInstanceId') || 'default'
  return NextResponse.json({ limits: await readClaudePlanLimits(sessionId, instance).catch(() => null) })
}
