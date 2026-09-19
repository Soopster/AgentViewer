import { NextRequest, NextResponse } from 'next/server'
import {
  disableRemoteAccess,
  enableRemoteAccess,
  getPublicRemoteAccessState,
  isRemoteScope,
  mintPairing,
  revokeAllRemoteSessions,
  revokeRemoteSession,
} from '@/lib/remoteAuth'
import { listAdvertisedEndpoints, setPreferredEndpointKind } from '@/lib/remoteEndpoints'
import type { EndpointKind } from '@/lib/remoteEndpoints'
import {
  disableTailscaleServe,
  enableTailscaleServe,
  readTailscaleStatus,
  tailscaleEndpoints,
} from '@/lib/tailscale'

const VALID_KINDS: EndpointKind[] = ['loopback', 'lan', 'private', 'tunnel']

/** The port this app is actually served on — endpoint URLs and the Tailscale
 *  Serve target both need it, and it can differ from the default per `--port`. */
function resolvePort(request: NextRequest): number {
  const fromUrl = Number(new URL(request.url).port)
  if (Number.isSafeInteger(fromUrl) && fromUrl > 0) return fromUrl
  const fromEnv = Number(process.env.PORT)
  return Number.isSafeInteger(fromEnv) && fromEnv > 0 ? fromEnv : 3000
}

async function respond(request: NextRequest) {
  const port = resolvePort(request)
  const tailscale = await readTailscaleStatus(port)
  const listing = await listAdvertisedEndpoints(tailscaleEndpoints(tailscale))
  return NextResponse.json({
    ...(await getPublicRemoteAccessState()),
    port,
    ...listing,
    tailscale: {
      available: tailscale.available,
      running: tailscale.running,
      serveEnabled: tailscale.serveEnabled,
      magicDnsName: tailscale.magicDnsName,
    },
  })
}

export async function GET(request: NextRequest) {
  return respond(request)
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const action = body?.action
  const scope = isRemoteScope(body?.scope) ? body.scope : 'full'

  if (action === 'enable') {
    await enableRemoteAccess()
    // Enabling with no scannable code is a dead end, so mint one immediately.
    await mintPairing({ scope })
    return respond(request)
  }
  if (action === 'disable') {
    await disableRemoteAccess()
    return respond(request)
  }
  if (action === 'pair') {
    await mintPairing({ scope })
    return respond(request)
  }
  if (action === 'revoke') {
    if (typeof body?.sessionId !== 'string' || !body.sessionId) {
      return NextResponse.json({ error: 'revoke requires a sessionId' }, { status: 400 })
    }
    const removed = await revokeRemoteSession(body.sessionId)
    if (!removed) return NextResponse.json({ error: 'No such paired device' }, { status: 404 })
    return respond(request)
  }
  if (action === 'revoke-all') {
    await revokeAllRemoteSessions()
    return respond(request)
  }
  if (action === 'prefer-endpoint') {
    const kind = body?.kind
    if (kind !== null && !VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: `kind must be null or one of ${VALID_KINDS.join(', ')}` }, { status: 400 })
    }
    await setPreferredEndpointKind(kind ?? null)
    return respond(request)
  }
  if (action === 'tailscale-serve') {
    const result = body?.enabled === false
      ? await disableTailscaleServe()
      : await enableTailscaleServe(resolvePort(request))
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'Tailscale command failed' }, { status: 400 })
    return respond(request)
  }

  return NextResponse.json(
    {
      error:
        'action must be enable, disable, pair, revoke, revoke-all, prefer-endpoint, or tailscale-serve',
    },
    { status: 400 },
  )
}
