// Node side of pstack: the user's role models, and what the panel shows.
// Roles live in the user's own config, never in a project: they decide what model usage is spent.
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { listPstackSkills, pstackLibraryDir } from './library'
import { parseRoleLine, PSTACK_ROLES, type PstackRoleProblem, type PstackRoles, type PstackSeat } from './roles'

export interface PstackState {
  configFile: string
  version: string
  skills: string[]
  roles: PstackRoles
  problems: PstackRoleProblem[]
}

export type SeatCheck = (seat: PstackSeat, cwd: string) => Promise<void>

export const pstackConfigFile = () => process.env.AGENT_VIEWER_PSTACK_CONFIG?.trim() || path.join(homedir(), '.config', 'agent-viewer', 'pstack.json')

const advertised: SeatCheck = async (seat, cwd) =>
  (await import('../coordinatorCapabilities')).validateCoordinatorSelection(seat.provider as never, cwd, seat.model, seat.effort, seat.instance)

async function readRoles(): Promise<{ roles: PstackRoles; problems: PstackRoleProblem[] }> {
  let source: string
  try { source = await readFile(pstackConfigFile(), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { roles: {}, problems: [] }
    return { roles: {}, problems: [{ role: 'pstack.json', message: String(error) }] }
  }
  try {
    const stored = (JSON.parse(source) as { roles?: Record<string, unknown> }).roles ?? {}
    return { roles: Object.fromEntries(PSTACK_ROLES.flatMap(spec => typeof stored[spec.id] === 'string' ? [[spec.id, stored[spec.id]]] : [])), problems: [] }
  } catch (error) {
    return { roles: {}, problems: [{ role: 'pstack.json', message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }] }
  }
}

const CHECK_TTL_MS = 5 * 60_000
let checked: { key: string; at: number; problems: PstackRoleProblem[] } | null = null

/** Checks each role against what its provider advertises. Cached, because this runs before a turn. */
export async function validatePstackRoles(roles: PstackRoles, cwd: string, check: SeatCheck = advertised): Promise<PstackRoleProblem[]> {
  const key = JSON.stringify([roles, cwd])
  if (check === advertised && checked?.key === key && Date.now() - checked.at < CHECK_TTL_MS) return checked.problems
  const results = await Promise.all(PSTACK_ROLES.map(async (spec): Promise<PstackRoleProblem | null> => {
    const line = roles[spec.id]?.trim()
    if (!line) return null
    const parsed = parseRoleLine(spec.id, line)
    if ('error' in parsed) return { role: spec.id, message: parsed.error }
    try {
      for (const seat of parsed.seats) await check(seat, cwd)
      return null
    } catch (error) {
      return { role: spec.id, message: error instanceof Error ? error.message : String(error) }
    }
  }))
  const problems = results.filter((item): item is PstackRoleProblem => item !== null)
  if (check === advertised) checked = { key, at: Date.now(), problems }
  return problems
}

export async function readPstack(cwd: string, check?: SeatCheck): Promise<PstackState> {
  const { roles, problems } = await readRoles()
  let version = 'missing'
  const manifest = path.join(pstackLibraryDir(), 'VENDOR.json')
  if (existsSync(manifest)) version = String((JSON.parse(await readFile(manifest, 'utf8')) as { version?: string }).version ?? 'unknown')
  return { configFile: pstackConfigFile(), version, skills: listPstackSkills(), roles, problems: [...problems, ...await validatePstackRoles(roles, cwd, check)] }
}

/**
 * Sets one role; an empty line clears it. A line nothing can read is refused and the file left alone.
 * A readable line naming an unadvertised model is saved and then shown with its problem.
 */
export async function savePstackRole(cwd: string, role: string, line: string, check?: SeatCheck): Promise<PstackState> {
  if (!PSTACK_ROLES.some(spec => spec.id === role)) throw new Error(`Unknown role "${role}"`)
  const value = line.trim().slice(0, 600)
  if (value) {
    const parsed = parseRoleLine(role, value)
    if ('error' in parsed) throw new Error(`${role}: ${parsed.error}`)
  }
  const current = await readRoles()
  // Saving over an unreadable file would silently drop every other role.
  if (current.problems.length) throw new Error(`Fix ${pstackConfigFile()} first: ${current.problems[0]!.message}`)
  const roles: Record<string, string> = { ...current.roles }
  if (value) roles[role] = value; else delete roles[role]
  const file = pstackConfigFile(), temporary = `${file}.${process.pid}.tmp`
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(temporary, `${JSON.stringify({ roles }, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, file)
  return readPstack(cwd, check)
}
