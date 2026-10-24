// Tailscale Serve as an opt-in *endpoint provider*, not a new connection kind.
//
// A tailnet address pairs through the ordinary bearer path in lib/remoteAuth.ts
// exactly like a LAN address does — the only thing Tailscale changes is which
// hosts can reach the port, and (once Serve is on) that there is an HTTPS
// origin with a real certificate. So this module contributes extra entries to
// listAdvertisedEndpoints() and nothing else; §2's pairing and §3's endpoint
// picker need no knowledge of it.
//
// Absence is not an error. A machine without Tailscale, or with it logged out,
// reports `available: false` and the UI hides the toggle — the same contract as
// the GitHub-CLI absence handling in lib/githubPr.ts.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AdvertisedEndpoint } from './remoteEndpoints'

const run = promisify(execFile)

const COMMAND_TIMEOUT_MS = 5_000

/** Where the binary hides when it isn't on PATH — the macOS App Store build
 *  ships it inside the bundle, which is the common case on a laptop. */
const FALLBACK_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
]

let binaryCache: string | null | undefined

async function resolveBinary(): Promise<string | null> {
  if (binaryCache !== undefined) return binaryCache
  const candidates = ['tailscale', ...FALLBACK_BINARIES]
  for (const candidate of candidates) {
    try {
      await run(candidate, ['version'], { timeout: COMMAND_TIMEOUT_MS })
      binaryCache = candidate
      return binaryCache
    } catch {
      continue
    }
  }
  binaryCache = null
  return null
}

export interface TailscaleStatus {
  available: boolean
  /** Logged in and up. A stopped or logged-out node is available but not running. */
  running: boolean
  /** Tailnet IPs for this machine (100.x.y.z and its IPv6 counterpart). */
  addresses: string[]
  /** Fully-qualified MagicDNS name, e.g. `laptop.tail1234.ts.net`. */
  magicDnsName: string | null
  /** Whether `tailscale serve` is currently fronting `servePort`. */
  serveEnabled: boolean
  servePort: number | null
}

const UNAVAILABLE: TailscaleStatus = {
  available: false,
  running: false,
  addresses: [],
  magicDnsName: null,
  serveEnabled: false,
  servePort: null,
}

function normalizeDnsName(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return value.replace(/\.$/, '')
}

async function readServe(binary: string, targetPort: number): Promise<{ enabled: boolean; port: number | null }> {
  try {
    const { stdout } = await run(binary, ['serve', 'status', '--json'], { timeout: COMMAND_TIMEOUT_MS })
    const parsed = JSON.parse(stdout) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }
    for (const [hostPort, config] of Object.entries(parsed.Web ?? {})) {
      for (const handler of Object.values(config.Handlers ?? {})) {
        if (!handler.Proxy?.includes(`:${targetPort}`)) continue
        const port = Number(hostPort.split(':').pop())
        return { enabled: true, port: Number.isSafeInteger(port) ? port : null }
      }
    }
  } catch {
    // `serve status` fails on old versions and when not logged in; that is
    // indistinguishable from "not serving" for our purposes.
  }
  return { enabled: false, port: null }
}

/** Reads node state. Never throws — an unusable Tailscale reports as such. */
export async function readTailscaleStatus(targetPort: number): Promise<TailscaleStatus> {
  const binary = await resolveBinary()
  if (!binary) return UNAVAILABLE
  try {
    const { stdout } = await run(binary, ['status', '--json'], { timeout: COMMAND_TIMEOUT_MS })
    const parsed = JSON.parse(stdout) as {
      BackendState?: string
      Self?: { TailscaleIPs?: string[]; DNSName?: string }
    }
    const running = parsed.BackendState === 'Running'
    const addresses = (parsed.Self?.TailscaleIPs ?? []).filter((entry) => typeof entry === 'string')
    const serve = running ? await readServe(binary, targetPort) : { enabled: false, port: null }
    return {
      available: true,
      running,
      addresses,
      magicDnsName: normalizeDnsName(parsed.Self?.DNSName),
      serveEnabled: serve.enabled,
      servePort: serve.port,
    }
  } catch {
    return { ...UNAVAILABLE, available: true }
  }
}

/** Puts `tailscale serve` in front of the local web port, giving the tailnet
 *  an HTTPS origin. Returns an error string rather than throwing so the UI can
 *  show Tailscale's own message (usually "HTTPS is not enabled in the tailnet"). */
export async function enableTailscaleServe(targetPort: number): Promise<{ ok: boolean; error?: string }> {
  const binary = await resolveBinary()
  if (!binary) return { ok: false, error: 'Tailscale is not installed' }
  try {
    await run(binary, ['serve', '--bg', '--https=443', `http://127.0.0.1:${targetPort}`], {
      timeout: COMMAND_TIMEOUT_MS * 4,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: commandError(error) }
  }
}

export async function disableTailscaleServe(): Promise<{ ok: boolean; error?: string }> {
  const binary = await resolveBinary()
  if (!binary) return { ok: false, error: 'Tailscale is not installed' }
  try {
    await run(binary, ['serve', '--https=443', 'off'], { timeout: COMMAND_TIMEOUT_MS * 2 })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: commandError(error) }
  }
}

function commandError(error: unknown): string {
  if (error && typeof error === 'object') {
    const shaped = error as { stderr?: string; message?: string }
    const stderr = shaped.stderr?.trim()
    if (stderr) return stderr.split('\n')[0]
    if (shaped.message) return shaped.message
  }
  return 'tailscale command failed'
}

/** Tailnet entries for listAdvertisedEndpoints().
 *
 *  The raw 100.x address is offered whenever the node is up — it is reachable
 *  from any other device on the tailnet over plain HTTP on the app's own port.
 *  The MagicDNS name only appears once Serve is on, because without Serve
 *  nothing is listening on 443 and the URL would simply fail to load. */
export function tailscaleEndpoints(status: TailscaleStatus): AdvertisedEndpoint[] {
  if (!status.available || !status.running) return []
  const entries: AdvertisedEndpoint[] = []
  if (status.serveEnabled && status.magicDnsName) {
    entries.push({
      id: `tunnel:${status.magicDnsName}`,
      kind: 'tunnel',
      host: status.magicDnsName,
      source: 'tailscale-serve',
      https: true,
      label: 'Tailscale (HTTPS, works off your Wi-Fi)',
    })
  }
  for (const address of status.addresses) {
    if (address.includes(':')) continue // IPv6 tailnet address; see remoteEndpoints.ts
    entries.push({
      id: `tunnel:${address}`,
      kind: 'tunnel',
      host: address,
      source: 'tailscale',
      https: false,
      label: 'Tailscale (tailnet devices only)',
    })
  }
  return entries
}
