// Local-first trust checks for mutating API requests, used by proxy.ts.
//
// Today this only recognizes same-machine Origins. Remote/mobile access adds
// a bearer-token trust path here (opt-in, issued via a pairing flow) without
// requiring another change to proxy.ts — see the "Remote access enablement"
// phase of the native-app plan.

export function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

interface TrustableRequest {
  headers: {
    get(name: string): string | null
  }
}

export function isTrustedRequest(request: TrustableRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin || isLocalOrigin(origin)) return true
  // Bearer-token trust path (remote/mobile access) lands in a later phase.
  return false
}
