// What an attached client and a daemon agree on, and how they find out.
//
// `agent-viewer --attach` routes every backend call through a running daemon
// that may be older than the client: herdr's skill puts this plainly — "client
// and server versions can differ after an update. Check `herdr status` before
// relying on new server features. A missing method is not permission to stop or
// upgrade a server."
//
// Bump DAEMON_PROTOCOL when a client needs a route or field the daemon must
// have, and name it in DAEMON_FEATURES. The client reports a mismatch; it never
// restarts or upgrades the daemon, which may be serving somebody else's turns.
export const DAEMON_PROTOCOL = 1

/** Capabilities a client may check by name before relying on them. */
export const DAEMON_FEATURES = [
  // Interactive Coordinator: enable/disable, delegate, message, resume,
  // plan review, decisions (app/api/sessions/[sessionId]/coordination).
  'coordination.interactive',
  // That read reports teammates whose turn ended with background work due.
  'coordination.backgroundAgents',
] as const

export type DaemonFeature = (typeof DAEMON_FEATURES)[number]

export type DaemonStatus = {
  name: 'agent-viewer'
  version: string
  protocol: number
  features: string[]
}

/**
 * Why an attached client cannot rely on this daemon, or null when it can.
 * A daemon NEWER than the client is fine: this client only asks for what it
 * knows about, and unknown response fields are ignored by construction.
 */
export function daemonCompatibilityWarning(status: DaemonStatus | null, required: readonly DaemonFeature[] = DAEMON_FEATURES): string | null {
  if (!status) return 'This daemon is older than the TUI: it does not report its version. Restart it with the current agent-viewer to use Coordinator controls.'
  if (status.protocol < DAEMON_PROTOCOL) {
    return `This daemon speaks protocol ${status.protocol}; the TUI expects ${DAEMON_PROTOCOL}. Restart the daemon with the current agent-viewer.`
  }
  const missing = required.filter(feature => !status.features.includes(feature))
  if (missing.length > 0) return `This daemon (${status.version}) is missing: ${missing.join(', ')}. Restart it with the current agent-viewer.`
  return null
}
