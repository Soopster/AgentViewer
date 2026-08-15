import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isTrustedRequest } from '@/lib/remoteAuth'

// Reject mutation requests that don't come from a trusted caller (same-machine
// origin, or — in a later phase — a valid remote-access bearer token).
// This prevents drive-by CSRF: a malicious page open in the same browser
// cannot fork sessions, send prompts, or overwrite provider config.
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT'])

export function proxy(request: NextRequest) {
  // A2A is an explicitly enabled, bearer-authenticated external facade. It
  // must accept non-local origins; handleA2AHttpRequest owns its auth gate.
  if (request.nextUrl.pathname === '/api/a2a' || request.nextUrl.pathname.startsWith('/api/a2a/')) {
    return NextResponse.next()
  }
  if (MUTATION_METHODS.has(request.method) && !isTrustedRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
