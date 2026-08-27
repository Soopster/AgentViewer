// Every address this machine can plausibly be reached on, for the pairing QR.
//
// The previous model was a single `lanAddress()` returning the *first*
// non-internal IPv4, which is wrong on any machine with more than one live
// interface (Wi-Fi + Ethernet + a VPN + Docker's bridge all qualify), and
// returns nothing at all inside a VM whose only address is on a host-only
// network. Enumerating and *tagging* instead lets the UI offer a sensible
// default while still exposing the others behind a "+N" expander.
//
// The chosen default is persisted **by kind, not by literal address**: a LAN
// address changes every time DHCP hands out a new lease, so remembering
// "192.168.1.47" would silently stop matching, while remembering "lan" keeps
// resolving to the right interface across networks.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import path from 'node:path'

export type EndpointKind = 'loopback' | 'lan' | 'private' | 'tunnel'

export interface AdvertisedEndpoint {
  /** Stable within a run; used as the UI's selection key. */
  id: string
  kind: EndpointKind
  /** Host portion of the URL — an IP literal, or a DNS name for tunnels. */
  host: string
  /** Interface it was discovered on, or the provider name for add-ons. */
  source: string
  https: boolean
  label: string
}

const ENDPOINTS_FILE = path.join(process.cwd(), '.agent-viewer-data', 'remote-endpoints.json')

/** Preference when the user hasn't chosen: the address a phone on the same
 *  Wi-Fi actually reaches, then a tunnel, then anything else, then loopback
 *  (which only ever works for this machine, so it is the last useful answer). */
const KIND_PRIORITY: EndpointKind[] = ['lan', 'tunnel', 'private', 'loopback']

function isKind(value: unknown): value is EndpointKind {
  return value === 'loopback' || value === 'lan' || value === 'private' || value === 'tunnel'
}

/** Interfaces whose addresses are a VPN/overlay rather than the local network.
 *  Tailscale hands out 100.64.0.0/10 (CGNAT) on a utun/tailscale device;
 *  WireGuard and friends follow the same shape. */
function looksLikeTunnelInterface(name: string): boolean {
  return /^(utun|tun|tap|wg|tailscale|ts)\d*/i.test(name)
}

function isCarrierGradeNat(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

function isRfc1918(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.')
}

function classify(address: string, interfaceName: string, internal: boolean): EndpointKind {
  if (internal) return 'loopback'
  if (isCarrierGradeNat(address) || looksLikeTunnelInterface(interfaceName)) return 'tunnel'
  if (isLinkLocal(address)) return 'private'
  // RFC1918 is the common case; a directly-routable address on a real
  // interface is reachable the same way, so it lands in the same bucket.
  if (isRfc1918(address)) return 'lan'
  return 'lan'
}

function describe(kind: EndpointKind, interfaceName: string): string {
  if (kind === 'loopback') return 'This machine only'
  if (kind === 'tunnel') return `VPN / tunnel (${interfaceName})`
  if (kind === 'private') return `Link-local (${interfaceName})`
  return `Local network (${interfaceName})`
}

/** IPv4 only, deliberately. IPv6 link-local addresses need a zone index to be
 *  usable in a URL (`http://[fe80::1%en0]`), which no phone QR scanner handles
 *  reliably; a global IPv6 address on a laptop is rare enough not to justify
 *  the extra shape here. Tunnels contribute DNS names via `extra` instead. */
function enumerateInterfaces(): AdvertisedEndpoint[] {
  const found: AdvertisedEndpoint[] = []
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue
      const kind = classify(entry.address, interfaceName, entry.internal)
      found.push({
        id: `${kind}:${entry.address}`,
        kind,
        host: entry.address,
        source: interfaceName,
        https: false,
        label: describe(kind, interfaceName),
      })
    }
  }
  return found
}

interface EndpointPreferences {
  defaultKind: EndpointKind | null
}

// Uncached for the same reason as lib/remoteAuth.ts: Next gives proxy.ts and
// the route handlers separate module instances, so a cached copy in one goes
// stale the moment the other writes.
async function readPreferences(): Promise<EndpointPreferences> {
  try {
    const parsed = JSON.parse(await readFile(ENDPOINTS_FILE, 'utf8')) as Record<string, unknown>
    return { defaultKind: isKind(parsed.defaultKind) ? parsed.defaultKind : null }
  } catch {
    return { defaultKind: null }
  }
}

/** Records which *kind* of endpoint to prefer. Passing null clears it. */
export async function setPreferredEndpointKind(kind: EndpointKind | null): Promise<void> {
  await mkdir(path.dirname(ENDPOINTS_FILE), { recursive: true })
  await writeFile(ENDPOINTS_FILE, JSON.stringify({ defaultKind: kind }, null, 2), 'utf8')
}

export interface EndpointListing {
  endpoints: AdvertisedEndpoint[]
  /** Id of the endpoint the pairing QR should use; null when none exist. */
  defaultId: string | null
  preferredKind: EndpointKind | null
}

function rank(endpoint: AdvertisedEndpoint, preferred: EndpointKind | null): number {
  if (preferred && endpoint.kind === preferred) return -1
  const index = KIND_PRIORITY.indexOf(endpoint.kind)
  return index === -1 ? KIND_PRIORITY.length : index
}

/** Enumerates every reachable endpoint, newest preference applied.
 *  `extra` is how add-on providers (Tailscale Serve) contribute addresses
 *  without this module knowing anything about them. */
export async function listAdvertisedEndpoints(
  extra: AdvertisedEndpoint[] = [],
): Promise<EndpointListing> {
  const { defaultKind } = await readPreferences()
  const seen = new Set<string>()
  const endpoints = [...extra, ...enumerateInterfaces()].filter((entry) => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
  endpoints.sort((left, right) => rank(left, defaultKind) - rank(right, defaultKind))
  return {
    endpoints,
    defaultId: endpoints[0]?.id ?? null,
    preferredKind: defaultKind,
  }
}

export function endpointUrl(endpoint: AdvertisedEndpoint, port: number | string): string {
  const scheme = endpoint.https ? 'https' : 'http'
  // A Serve-fronted tunnel terminates TLS on 443 and needs no explicit port.
  if (endpoint.https && String(port) === '443') return `${scheme}://${endpoint.host}`
  return `${scheme}://${endpoint.host}:${port}`
}
