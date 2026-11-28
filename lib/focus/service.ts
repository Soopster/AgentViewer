// Focus Mode's block and held items, one file shared by every surface on this
// machine (a TUI and a web tab honour the same block). Written temp-and-rename,
// 0600: a torn write would read back as "no block", which is the one failure
// that silently undoes what the person asked for.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FOCUS_HELD_LIMIT, FOCUS_MAX_MINUTES, FOCUS_MIN_MINUTES, type FocusHeldItem, type FocusService, type FocusState } from '../plugins/focusMode'

const file = () => process.env.AGENT_VIEWER_FOCUS_FILE ?? path.join(process.cwd(), '.agent-viewer-data', 'focus.json')
const EMPTY: FocusState = { active: null, held: [], last: null }

async function load(): Promise<FocusState> {
  try {
    const parsed = JSON.parse(await readFile(file(), 'utf8')) as Partial<FocusState>
    return { active: parsed.active ?? null, held: Array.isArray(parsed.held) ? parsed.held : [], last: parsed.last ?? null }
  } catch { return EMPTY }
}

let chain: Promise<unknown> = Promise.resolve()
function update(change: (state: FocusState) => FocusState): Promise<FocusState> {
  const next = chain.catch(() => {}).then(async () => {
    const state = settle(change(settle(await load())))
    await mkdir(path.dirname(file()), { recursive: true })
    const temporary = `${file()}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, file())
    return state
  })
  chain = next
  return next
}

/** A block whose time is up is over: what it held becomes the digest. */
function settle(state: FocusState, now = Date.now()): FocusState {
  if (!state.active || now < state.active.endsAt) return state
  return { active: null, held: [], last: { ...state.active, endedAt: state.active.endsAt, held: state.held } }
}

export const nativeFocus: FocusService = {
  async read() { return settle(await load()) },
  start(minutes) {
    const span = Math.min(FOCUS_MAX_MINUTES, Math.max(FOCUS_MIN_MINUTES, Math.round(minutes)))
    const now = Date.now()
    // Restarting a running block extends it and keeps what it already held.
    return update(state => ({ active: { startedAt: state.active?.startedAt ?? now, endsAt: now + span * 60_000 }, held: state.active ? state.held : [], last: state.last }))
  },
  end() {
    return update(state => state.active ? { active: null, held: [], last: { ...state.active, endedAt: Date.now(), held: state.held } } : state)
  },
  async hold(items) {
    if (!items.length) return
    await update(state => {
      if (!state.active) return state
      const known = new Set(state.held.map(item => item.id))
      const added = items.filter(item => !known.has(item.id))
      return { ...state, held: [...state.held, ...added].slice(-FOCUS_HELD_LIMIT) }
    })
  },
  clearDigest() { return update(state => ({ ...state, last: null })) },
}

export const focusHeldItem = (input: Omit<FocusHeldItem, 'id' | 'at'>): FocusHeldItem => ({ id: randomUUID(), at: Date.now(), ...input })
