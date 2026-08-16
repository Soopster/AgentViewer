// Local-first trust checks for mutating API requests, used by proxy.ts, plus
// the token system behind opt-in remote/mobile access.
//
// Same-machine Origins are always trusted (desktop's own window navigates to
// a real http://127.0.0.1 URL, so it already satisfies this — see the
// "Desktop Design" section of the native-app plan). A different machine (a
// paired phone) can never share that Origin, so it authenticates instead
// with a bearer token issued via the pairing flow below — modeled on the
// existing AGENT_VIEWER_A2A_TOKEN facade in lib/a2aAdapter.ts.

import { randomBytes, timingSafeEqual } from 'node:crypto'
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

/** Cookie set by POST /api/remote/handshake once a bearer token validates.
 *  EventSource (used for the SSE session/run-changes streams) can't send
 *  custom headers, so the cookie — not the header — is what makes those
 *  work for a paired remote client; carried automatically once set. */
export const REMOTE_ACCESS_COOKIE = 'agent_viewer_remote_token'

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

export async function isTrustedRequest(request: TrustableRequest): Promise<boolean> {
  const origin = request.headers.get('origin')
  if (!origin || isLocalOrigin(origin)) return true
  if (await isValidRemoteBearer(request.headers.get('authorization'))) return true
  const cookieToken = cookieValue(request.headers.get('cookie'), REMOTE_ACCESS_COOKIE)
  if (!cookieToken) return false
  return isValidRemoteBearer(`Bearer ${cookieToken}`)
}

// --- Remote access token state -------------------------------------------

const REMOTE_AUTH_FILE = path.join(process.cwd(), '.agent-viewer-data', 'remote-access.json')

export interface RemoteAccessState {
  enabled: boolean
  token: string | null
  createdAt: string | null
}

const DISABLED_STATE: RemoteAccessState = { enabled: false, token: null, createdAt: null }

let cache: RemoteAccessState | null = null

async function readState(): Promise<RemoteAccessState> {
  if (cache) return cache
  try {
    const contents = await readFile(REMOTE_AUTH_FILE, 'utf8')
    const parsed = JSON.parse(contents) as Partial<RemoteAccessState>
    cache = {
      enabled: parsed.enabled === true,
      token: typeof parsed.token === 'string' ? parsed.token : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    }
  } catch {
    cache = DISABLED_STATE
  }
  return cache
}

async function writeState(state: RemoteAccessState): Promise<RemoteAccessState> {
  cache = state
  await mkdir(path.dirname(REMOTE_AUTH_FILE), { recursive: true })
  await writeFile(REMOTE_AUTH_FILE, JSON.stringify(state, null, 2), 'utf8')
  return state
}

export async function getRemoteAccessState(): Promise<RemoteAccessState> {
  return readState()
}

/** Turns remote access on, generating a token if one isn't already set. */
export async function enableRemoteAccess(): Promise<RemoteAccessState> {
  const current = await readState()
  return writeState({
    enabled: true,
    token: current.token ?? randomBytes(32).toString('base64url'),
    createdAt: current.createdAt ?? new Date().toISOString(),
  })
}

/** Turns remote access off. Keeps the token so re-enabling doesn't silently
 *  re-validate an old paired device's cached QR — rotate separately for that. */
export async function disableRemoteAccess(): Promise<RemoteAccessState> {
  const current = await readState()
  return writeState({ ...current, enabled: false })
}

/** Issues a fresh token, invalidating the previous one — every paired device
 *  must re-scan. Does not change the enabled flag. */
export async function rotateRemoteAccessToken(): Promise<RemoteAccessState> {
  const current = await readState()
  return writeState({
    enabled: current.enabled,
    token: randomBytes(32).toString('base64url'),
    createdAt: new Date().toISOString(),
  })
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) return false
  return timingSafeEqual(leftBuf, rightBuf)
}

/** Validates a request's `Authorization: Bearer <token>` header against the
 *  current remote-access token. Always false while remote access is off. */
export async function isValidRemoteBearer(authorizationHeader: string | null): Promise<boolean> {
  const state = await readState()
  if (!state.enabled || !state.token) return false
  const header = authorizationHeader ?? ''
  const supplied = /^Bearer /i.test(header) ? header.slice(7) : ''
  if (!supplied) return false
  return tokensEqual(supplied, state.token)
}
