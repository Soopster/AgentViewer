// Local-first trust checks for mutating API requests, used by proxy.ts, plus
// the pairing system behind opt-in remote/mobile access.
//
// Same-machine Origins are always trusted (desktop's own window navigates to
// a real http://127.0.0.1 URL, so it already satisfies this — see the
// "Desktop Design" section of the native-app plan). A different machine (a
// paired phone) can never share that Origin, so it authenticates instead
// with a credential issued via the pairing flow below.
//
// Two credential kinds, deliberately different in lifetime and storage:
//
//   - A *pairing token* is short-lived (minutes), single-use, and exists only
//     to be carried in a QR code. It is stored in plaintext so the popover can
//     re-render the same QR while it is still valid; that is safe precisely
//     because it expires and burns on first use.
//   - A *device session secret* is the long-lived credential a paired phone
//     actually holds. It is stored as a SHA-256 hash, so the state file on
//     disk cannot be replayed as a device. It is returned exactly once, at
//     handshake time, and lives after that only in the client's httpOnly
//     cookie.
//
// Each device gets its own session, so revoking one phone leaves the others
// paired — the property the previous single-shared-token model could not
// offer.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

/** Cookie set by POST /api/remote/handshake once a pairing token is redeemed.
 *  EventSource (used for the SSE session/run-changes streams) can't send
 *  custom headers, so the cookie — not the header — is what makes those
 *  work for a paired remote client; carried automatically once set. */
export const REMOTE_ACCESS_COOKIE = 'agent_viewer_remote_token'

/** Two scopes, not eight. `read-only` can watch a run but not drive one;
 *  proxy.ts turns that into "no mutating methods". More granular scopes can
 *  grow out of this later — a scope set can widen, it cannot shrink. */
export type RemoteScope = 'full' | 'read-only'

export function isRemoteScope(value: unknown): value is RemoteScope {
  return value === 'full' || value === 'read-only'
}

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

// --- State ----------------------------------------------------------------

const REMOTE_AUTH_FILE = path.join(process.cwd(), '.agent-viewer-data', 'remote-access.json')

/** Minted for a QR code; single-use and short-lived. */
export interface RemotePairing {
  id: string
  token: string
  scope: RemoteScope
  createdAt: string
  expiresAt: string
}

/** One paired device. `secretHash` is a SHA-256 of the credential the device
 *  holds; the credential itself is never persisted. */
export interface RemoteDeviceSession {
  id: string
  secretHash: string
  scope: RemoteScope
  label: string
  createdAt: string
  lastSeenAt: string | null
  userAgent: string | null
}

export interface RemoteAccessState {
  /** Read at process start by bin/agent-viewer.mjs and src-tauri/src/lib.rs to
   *  decide the bind address, so it must stay a top-level boolean. */
  enabled: boolean
  createdAt: string | null
  pairings: RemotePairing[]
  sessions: RemoteDeviceSession[]
}

const DISABLED_STATE: RemoteAccessState = {
  enabled: false,
  createdAt: null,
  pairings: [],
  sessions: [],
}

export const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000

/** Identity of the single device session synthesized from a pre-upgrade token. */
const LEGACY_SESSION_ID = 'legacy-shared-token'

// Deliberately uncached. proxy.ts and the route handlers are *separate module
// instances* in Next, so a module-level cache in one never sees writes made by
// the other — a revoked device kept working because the proxy's copy was
// stale. Every check therefore reads the file, which only happens for genuinely
// remote requests (local callers short-circuit in evaluateRequestTrust before
// touching disk).
/** Serializes read-modify-write cycles; several routes can mutate at once. */
let writeChain: Promise<unknown> = Promise.resolve()

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parsePairing(raw: unknown): RemotePairing | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || typeof entry.token !== 'string') return null
  if (typeof entry.expiresAt !== 'string') return null
  return {
    id: entry.id,
    token: entry.token,
    scope: isRemoteScope(entry.scope) ? entry.scope : 'full',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    expiresAt: entry.expiresAt,
  }
}

function parseSession(raw: unknown): RemoteDeviceSession | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || typeof entry.secretHash !== 'string') return null
  return {
    id: entry.id,
    secretHash: entry.secretHash,
    scope: isRemoteScope(entry.scope) ? entry.scope : 'full',
    label: typeof entry.label === 'string' ? entry.label : 'Paired device',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    lastSeenAt: typeof entry.lastSeenAt === 'string' ? entry.lastSeenAt : null,
    userAgent: typeof entry.userAgent === 'string' ? entry.userAgent : null,
  }
}

/** Reads the state file, upgrading the pre-per-device shape in place.
 *
 *  The old format was `{ enabled, token, createdAt }`, where `token` was both
 *  the QR secret and the cookie value for every paired device. Devices paired
 *  under it hold that exact string in their cookie, so the upgrade turns it
 *  into a single ordinary device session — they stay paired, and the very next
 *  revoke can cut them off individually like any other device. */
async function readState(): Promise<RemoteAccessState> {
  try {
    const contents = await readFile(REMOTE_AUTH_FILE, 'utf8')
    const parsed = JSON.parse(contents) as Record<string, unknown>
    const enabled = parsed.enabled === true
    const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : null
    const pairings = Array.isArray(parsed.pairings)
      ? parsed.pairings.map(parsePairing).filter((entry): entry is RemotePairing => entry !== null)
      : []
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(parseSession).filter((entry): entry is RemoteDeviceSession => entry !== null)
      : []

    if (typeof parsed.token === 'string' && parsed.token && !Array.isArray(parsed.sessions)) {
      sessions.push({
        // A fixed id, not a fresh uuid: readState() runs on every remote
        // request now, and a per-read id would make the device unrevokable
        // (the id in the listing would never match the one being validated).
        id: LEGACY_SESSION_ID,
        secretHash: sha256(parsed.token),
        scope: 'full',
        label: 'Device paired before per-device sessions',
        createdAt: createdAt ?? new Date().toISOString(),
        lastSeenAt: null,
        userAgent: null,
      })
    }

    return { enabled, createdAt, pairings, sessions }
  } catch {
    return DISABLED_STATE
  }
}

async function persist(state: RemoteAccessState): Promise<RemoteAccessState> {
  await mkdir(path.dirname(REMOTE_AUTH_FILE), { recursive: true })
  await writeFile(REMOTE_AUTH_FILE, JSON.stringify(state, null, 2), 'utf8')
  return state
}

/** Read-modify-write against the state file, serialized. */
function mutate<T>(update: (state: RemoteAccessState) => Promise<{ state: RemoteAccessState; result: T }>): Promise<T> {
  const next = writeChain.then(async () => {
    const current = await readState()
    const { state, result } = await update(current)
    await persist(state)
    return result
  })
  // Keep the chain alive even when a caller's update rejects.
  writeChain = next.catch(() => undefined)
  return next
}

function prunePairings(pairings: RemotePairing[], now: number): RemotePairing[] {
  return pairings.filter((entry) => Date.parse(entry.expiresAt) > now)
}

export async function getRemoteAccessState(): Promise<RemoteAccessState> {
  return readState()
}

/** What the settings UI is allowed to see: never a session secret hash, and
 *  only pairing tokens that are still live (they are the QR payload). */
export interface PublicRemoteAccessState {
  enabled: boolean
  createdAt: string | null
  pairing: { id: string; token: string; scope: RemoteScope; expiresAt: string } | null
  sessions: Array<Omit<RemoteDeviceSession, 'secretHash'>>
}

export async function getPublicRemoteAccessState(): Promise<PublicRemoteAccessState> {
  const state = await readState()
  const live = prunePairings(state.pairings, Date.now())
  const newest = live.reduce<RemotePairing | null>(
    (best, entry) => (!best || Date.parse(entry.createdAt) > Date.parse(best.createdAt) ? entry : best),
    null,
  )
  return {
    enabled: state.enabled,
    createdAt: state.createdAt,
    pairing: newest
      ? { id: newest.id, token: newest.token, scope: newest.scope, expiresAt: newest.expiresAt }
      : null,
    sessions: state.sessions.map(({ secretHash: _secretHash, ...rest }) => rest),
  }
}

export async function enableRemoteAccess(): Promise<RemoteAccessState> {
  return mutate(async (current) => {
    const state: RemoteAccessState = {
      ...current,
      enabled: true,
      createdAt: current.createdAt ?? new Date().toISOString(),
    }
    return { state, result: state }
  })
}

/** Turns remote access off. Paired sessions are kept — re-enabling should not
 *  force every device to re-scan — but nothing validates while it is off. */
export async function disableRemoteAccess(): Promise<RemoteAccessState> {
  return mutate(async (current) => {
    const state: RemoteAccessState = { ...current, enabled: false, pairings: [] }
    return { state, result: state }
  })
}

/** Mints a single-use, short-lived pairing token for one QR code. Supersedes
 *  any earlier live pairing so only one code is ever scannable at a time. */
export async function mintPairing(
  options: { ttlMs?: number; scope?: RemoteScope } = {},
): Promise<RemotePairing> {
  const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_TTL_MS
  const now = Date.now()
  const pairing: RemotePairing = {
    id: randomUUID(),
    token: randomBytes(32).toString('base64url'),
    scope: options.scope ?? 'full',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  }
  return mutate(async (current) => {
    const state: RemoteAccessState = {
      ...current,
      enabled: true,
      createdAt: current.createdAt ?? pairing.createdAt,
      pairings: [pairing],
    }
    return { state, result: pairing }
  })
}

export interface ConsumedPairing {
  session: Omit<RemoteDeviceSession, 'secretHash'>
  /** `<sessionId>.<secret>` — the value the client stores. Returned once. */
  credential: string
}

/** Redeems a pairing token for a per-device session. Single-use: the pairing
 *  is removed in the same write that creates the session, so a replayed QR
 *  scan (or a token lifted from a log) cannot pair a second device. */
export async function consumePairing(
  token: string,
  details: { label?: string; userAgent?: string | null } = {},
): Promise<ConsumedPairing | null> {
  if (!token) return null
  return mutate(async (current) => {
    if (!current.enabled) return { state: current, result: null }
    const now = Date.now()
    const live = prunePairings(current.pairings, now)
    const match = live.find((entry) => secretsEqual(entry.token, token))
    if (!match) {
      return { state: { ...current, pairings: live }, result: null }
    }
    const secret = randomBytes(32).toString('base64url')
    const session: RemoteDeviceSession = {
      id: randomUUID(),
      secretHash: sha256(secret),
      scope: match.scope,
      label: details.label?.trim() || deviceLabel(details.userAgent ?? null),
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      userAgent: details.userAgent ?? null,
    }
    const state: RemoteAccessState = {
      ...current,
      pairings: live.filter((entry) => entry.id !== match.id),
      sessions: [...current.sessions, session],
    }
    const { secretHash: _secretHash, ...publicSession } = session
    return { state, result: { session: publicSession, credential: `${session.id}.${secret}` } }
  })
}

export async function revokeRemoteSession(sessionId: string): Promise<boolean> {
  return mutate(async (current) => {
    const remaining = current.sessions.filter((entry) => entry.id !== sessionId)
    if (remaining.length === current.sessions.length) return { state: current, result: false }
    return { state: { ...current, sessions: remaining }, result: true }
  })
}

/** Revokes every paired device and invalidates any outstanding QR. */
export async function revokeAllRemoteSessions(): Promise<RemoteAccessState> {
  return mutate(async (current) => {
    const state: RemoteAccessState = { ...current, pairings: [], sessions: [] }
    return { state, result: state }
  })
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Paired device'
  if (/iPhone/i.test(userAgent)) return 'iPhone'
  if (/iPad/i.test(userAgent)) return 'iPad'
  if (/Android/i.test(userAgent)) return 'Android device'
  if (/Macintosh/i.test(userAgent)) return 'Mac'
  if (/Windows/i.test(userAgent)) return 'Windows PC'
  if (/Linux/i.test(userAgent)) return 'Linux device'
  return 'Paired device'
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) return false
  return timingSafeEqual(leftBuf, rightBuf)
}

// --- Request validation ---------------------------------------------------

const LAST_SEEN_THROTTLE_MS = 60_000

function touchSession(sessionId: string, userAgent: string | null): void {
  // Fire-and-forget: a failed bookkeeping write must never fail the request.
  void mutate(async (current) => {
    const index = current.sessions.findIndex((entry) => entry.id === sessionId)
    if (index === -1) return { state: current, result: false }
    const existing = current.sessions[index]
    const last = existing.lastSeenAt ? Date.parse(existing.lastSeenAt) : 0
    if (Date.now() - last < LAST_SEEN_THROTTLE_MS) return { state: current, result: false }
    const sessions = [...current.sessions]
    sessions[index] = {
      ...existing,
      lastSeenAt: new Date().toISOString(),
      userAgent: userAgent ?? existing.userAgent,
    }
    return { state: { ...current, sessions }, result: true }
  }).catch(() => undefined)
}

export interface TrustVerdict {
  trusted: boolean
  /** Local callers get full access; a remote caller gets its session's scope. */
  scope: RemoteScope
  source: 'local' | 'session' | 'none'
  sessionId: string | null
}

const UNTRUSTED: TrustVerdict = { trusted: false, scope: 'read-only', source: 'none', sessionId: null }

/** Resolves a `<sessionId>.<secret>` credential against the paired sessions. */
async function resolveCredential(credential: string | null, userAgent: string | null): Promise<TrustVerdict> {
  if (!credential) return UNTRUSTED
  const state = await readState()
  if (!state.enabled) return UNTRUSTED
  const separator = credential.indexOf('.')
  if (separator <= 0) return UNTRUSTED
  const sessionId = credential.slice(0, separator)
  const secret = credential.slice(separator + 1)
  if (!secret) return UNTRUSTED
  const session = state.sessions.find((entry) => entry.id === sessionId)
  if (!session) return UNTRUSTED
  if (!secretsEqual(session.secretHash, sha256(secret))) return UNTRUSTED
  touchSession(session.id, userAgent)
  return { trusted: true, scope: session.scope, source: 'session', sessionId: session.id }
}

export async function evaluateRequestTrust(request: TrustableRequest): Promise<TrustVerdict> {
  const origin = request.headers.get('origin')
  if (!origin || isLocalOrigin(origin)) {
    return { trusted: true, scope: 'full', source: 'local', sessionId: null }
  }
  const userAgent = request.headers.get('user-agent')
  const header = request.headers.get('authorization') ?? ''
  const bearer = /^Bearer /i.test(header) ? header.slice(7) : null
  const fromHeader = await resolveCredential(bearer, userAgent)
  if (fromHeader.trusted) return fromHeader
  return resolveCredential(cookieValue(request.headers.get('cookie'), REMOTE_ACCESS_COOKIE), userAgent)
}

export async function isTrustedRequest(request: TrustableRequest): Promise<boolean> {
  return (await evaluateRequestTrust(request)).trusted
}
