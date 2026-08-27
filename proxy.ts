import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { evaluateRequestTrust, isLocalOrigin } from '@/lib/remoteAuth'

// Reject mutation requests from non-local callers unless they're trusted —
// this prevents drive-by CSRF: a malicious page open in the same browser
// cannot fork sessions, send prompts, or overwrite provider config.
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT'])

function corsHeaders(origin: string): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  }
}

export async function proxy(request: NextRequest) {
  // A2A is an explicitly enabled, bearer-authenticated external facade. It
  // must accept non-local origins; handleA2AHttpRequest owns its auth gate.
  if (request.nextUrl.pathname === '/api/a2a' || request.nextUrl.pathname.startsWith('/api/a2a/')) {
    return NextResponse.next()
  }

  const origin = request.headers.get('origin')
  const isRemoteOrigin = origin != null && !isLocalOrigin(origin)

  // Answer CORS preflight directly — none of the existing route handlers
  // export OPTIONS, and this only needs headers, no route logic. Must run
  // before the handshake exemption below, or preflight for it 405s instead
  // of getting a proper 204.
  if (request.method === 'OPTIONS') {
    return isRemoteOrigin ? new NextResponse(null, { status: 204, headers: corsHeaders(origin) }) : NextResponse.next()
  }

  // The handshake route is the one place a bearer token arrives with no
  // cookie yet — it must see every attempt (including invalid ones) itself
  // to return its own 401 + WWW-Authenticate, not this file's generic 403.
  if (request.nextUrl.pathname === '/api/remote/handshake') {
    const response = NextResponse.next()
    if (isRemoteOrigin) {
      for (const [key, value] of Object.entries(corsHeaders(origin))) {
        response.headers.set(key, value)
      }
    }
    return response
  }

  // A non-local Origin means this request reached us over the network (a
  // paired remote/mobile client — see lib/remoteAuth.ts), where GET is not
  // "safe" the way ordinary CSRF defenses treat it: an unauthenticated GET
  // would leak full session transcripts to anyone who can reach the LAN
  // bind. So once remote, every method needs a trusted caller; same-machine
  // traffic keeps its original behavior (only mutations are checked, since
  // isTrustedRequest already trusts any local/no-origin request instantly).
  const needsCheck = isRemoteOrigin || MUTATION_METHODS.has(request.method)
  if (needsCheck) {
    const verdict = await evaluateRequestTrust(request)
    if (!verdict.trusted) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // A read-only pairing may watch anything it can already see, but must not
    // drive a session — every state change in this app is a mutating method,
    // so the scope check is exactly the method check.
    if (verdict.scope === 'read-only' && MUTATION_METHODS.has(request.method)) {
      return NextResponse.json(
        { error: 'This device is paired read-only' },
        { status: 403, headers: isRemoteOrigin && origin ? corsHeaders(origin) : undefined },
      )
    }
  }

  const response = NextResponse.next()
  if (isRemoteOrigin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      response.headers.set(key, value)
    }
  }
  return response
}

export const config = {
  matcher: '/api/:path*',
}
