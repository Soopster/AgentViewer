import { NextResponse } from 'next/server'
import { DAEMON_FEATURES, DAEMON_PROTOCOL, type DaemonStatus } from '@/lib/daemonProtocol'
import packageJson from '@/package.json'

/** Version handshake for attached clients (herdr's `status`). Never gated: a
 *  client has to be able to ask an unknown daemon what it is. */
export async function GET() {
  const status: DaemonStatus = {
    name: 'agent-viewer',
    version: packageJson.version,
    protocol: DAEMON_PROTOCOL,
    features: [...DAEMON_FEATURES],
  }
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
}
