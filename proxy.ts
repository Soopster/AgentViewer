import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Reject mutation requests that come from non-localhost origins.
// This prevents drive-by CSRF: a malicious page open in the same browser
// cannot fork sessions, send prompts, or overwrite provider config.
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT'])

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function proxy(request: NextRequest) {
  if (MUTATION_METHODS.has(request.method)) {
    const origin = request.headers.get('origin')
    if (origin && !isLocalOrigin(origin)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
