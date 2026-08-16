import { NextRequest, NextResponse } from 'next/server'
import { networkInterfaces } from 'node:os'
import {
  disableRemoteAccess,
  enableRemoteAccess,
  getRemoteAccessState,
  rotateRemoteAccessToken,
} from '@/lib/remoteAuth'

/** First non-internal IPv4 LAN address, for the pairing payload's URL — the
 *  same address a phone on the same Wi-Fi would actually reach this machine
 *  on. Falls back to null (UI shows manual-entry guidance instead). */
function lanAddress(): string | null {
  const interfaces = networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return null
}

function toResponse(state: Awaited<ReturnType<typeof getRemoteAccessState>>) {
  return NextResponse.json({ ...state, lanAddress: lanAddress() })
}

export async function GET() {
  const state = await getRemoteAccessState()
  return toResponse(state)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = body?.action
  if (action === 'enable') return toResponse(await enableRemoteAccess())
  if (action === 'disable') return toResponse(await disableRemoteAccess())
  if (action === 'rotate') return toResponse(await rotateRemoteAccessToken())
  return NextResponse.json({ error: 'action must be enable, disable, or rotate' }, { status: 400 })
}
