// Remote access as a plugin service: the daemon's pairing state and actions.
// Pairing is with the running web daemon (its HTTP server is what a phone
// reaches), so both renderers drive the same /api/remote-access endpoint —
// the Web from its own page, the TUI against the daemon it is attached to or
// the default local one. Browser-safe.
export type RemoteScope = 'full' | 'read-only'
export type RemotePairedDevice = { id: string; label: string; scope: RemoteScope; createdAt: string; lastSeenAt: string | null; userAgent: string | null }
export type RemoteEndpoint = { id: string; kind: 'loopback' | 'lan' | 'private' | 'tunnel'; host: string; source: string; https: boolean; label: string }
export type RemoteAccessView = {
  enabled: boolean
  pairing: { id: string; token: string; scope: RemoteScope; expiresAt: string } | null
  sessions: RemotePairedDevice[]
  port: number
  endpoints: RemoteEndpoint[]
  defaultId: string | null
}
export type RemoteAccessAction =
  | { action: 'enable' | 'disable' | 'revoke-all' }
  | { action: 'pair'; scope?: RemoteScope }
  | { action: 'revoke'; sessionId: string }

export type PluginRemoteAccessService = {
  /** Where the daemon is, for saying so when it is not running. */
  readonly daemonUrl: string
  readonly read: (signal?: AbortSignal) => Promise<RemoteAccessView>
  readonly act: (request: RemoteAccessAction, signal?: AbortSignal) => Promise<RemoteAccessView>
}

/** The URL a phone scans: the code rides in the fragment, never reaching a server log. */
export function remotePairingUrl(state: RemoteAccessView): string | null {
  if (!state.pairing) return null
  const endpoint = state.endpoints.find(entry => entry.id === state.defaultId) ?? state.endpoints[0]
  if (!endpoint) return null
  const origin = endpoint.https ? `https://${endpoint.host}` : `http://${endpoint.host}:${state.port}`
  return `${origin}/pair#token=${encodeURIComponent(state.pairing.token)}`
}
