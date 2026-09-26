// Other machines' Agent Viewer daemons this one watches — herdr's combined
// agent list across machines, over the pairing Agent Viewer already has.
//
// A machine is added by redeeming a pairing URL from `agent-viewer pair` run
// ON that machine (`--scope read-only` is enough and is what to ask for: the
// roster only reads). The single-use token is exchanged once for the same
// per-device credential a paired phone gets, so the other machine lists it
// under its paired devices and can revoke it there.
//
// Plain JS with no imports beyond node: the bin CLI runs under vanilla node.
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const COOKIE = 'agent_viewer_remote_token'
const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

export function machinesFile(root = process.cwd()) {
  return path.join(root, '.agent-viewer-data', 'machines.json')
}

/** Machines as stored; an unreadable file reads as none rather than throwing. */
export function readMachines(root = process.cwd()) {
  try {
    const parsed = JSON.parse(readFileSync(machinesFile(root), 'utf8'))
    if (!Array.isArray(parsed?.machines)) return []
    return parsed.machines.filter((entry) =>
      entry && typeof entry.name === 'string' && typeof entry.baseUrl === 'string' && typeof entry.credential === 'string')
  } catch {
    return []
  }
}

/**
 * The file holds live device credentials: written 0600 through a temp file and
 * a rename, so a torn write cannot leave unparseable JSON that reads back as
 * "no machines" and silently forgets them.
 */
export function writeMachines(machines, root = process.cwd()) {
  const file = machinesFile(root)
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify({ version: 1, machines }, null, 2)}\n`, { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, file)
}

export function validateMachineName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new Error('A machine name is a lowercase letter followed by up to 31 letters, digits, - or _')
  }
  return name
}

/** `http://host:port/pair#token=…` → its origin and token. */
export function parsePairingUrl(raw) {
  let url
  try {
    url = new URL(String(raw).trim())
  } catch {
    throw new Error('Expected the pairing URL printed by `agent-viewer pair` on the other machine')
  }
  const token = new URLSearchParams(url.hash.replace(/^#/, '')).get('token')
  if (!token || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('That URL carries no pairing token — copy the whole URL `agent-viewer pair` printed')
  }
  return { origin: url.origin, token }
}

function credentialFrom(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  for (const cookie of cookies) {
    const match = cookie.match(new RegExp(`(?:^|,\\s*)${COOKIE}=([^;,\\s]+)`))
    if (match) return decodeURIComponent(match[1])
  }
  return null
}

/** Redeem a pairing URL and store the machine. The credential is never returned or printed. */
export async function addMachine({ name, pairingUrl, root = process.cwd(), fetchImpl = fetch }) {
  validateMachineName(name)
  const { origin, token } = parsePairingUrl(pairingUrl)
  const existing = readMachines(root)
  if (existing.some((machine) => machine.name === name)) throw new Error(`A machine named ${name} is already added — remove it first`)
  const response = await fetchImpl(`${origin}/api/remote/handshake`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error ?? `Pairing failed (HTTP ${response.status})`)
  const credential = credentialFrom(response)
  if (!credential) throw new Error('The other machine accepted the pairing but returned no credential')
  const machine = {
    name,
    baseUrl: origin,
    credential,
    scope: payload?.scope === 'full' ? 'full' : 'read-only',
    addedAt: new Date().toISOString(),
  }
  writeMachines([...existing, machine], root)
  return { name: machine.name, baseUrl: machine.baseUrl, scope: machine.scope }
}

export function removeMachine(name, root = process.cwd()) {
  const existing = readMachines(root)
  const next = existing.filter((machine) => machine.name !== name)
  if (next.length === existing.length) return false
  writeMachines(next, root)
  return true
}

/** Headers that authenticate a request to a stored machine. */
export function machineHeaders(machine) {
  return { Cookie: `${COOKIE}=${encodeURIComponent(machine.credential)}`, Accept: 'application/json' }
}
