// Reload mods when their files change, so editing a mod needs no restart and no
// `agent-viewer mods reload`. The watcher only writes the same revision marker an
// explicit reload writes (lib/plugins/modReload.ts): every Web tab and TUI sharing
// the configuration applies it on its own schedule, and nothing here imports mod code.
//
// A change is a change to a source-like file's name, size or mtime, so a mod
// that writes its own state (a log, a cache) beside its code does not reload
// itself in a loop: only files with a code or manifest extension count, and a
// reload is at most once per MIN_INTERVAL_MS however busy the directory is.
import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { readModReloadRequest, requestModReload } from './modReload'

const SOURCE = /\.(?:json|[cm]?[jt]sx?|css|md)$/i
const IGNORED = new Set(['node_modules', '.git', '.next', '.turbo'])
const DEBOUNCE_MS = 400
const MIN_INTERVAL_MS = 3_000
const ROOTS_POLL_MS = 10_000
const MAX_FILES = 4_000

/** A fingerprint of a mod tree's source files: what a reload would pick up. Bounded, and never follows symlinks. */
export function modTreeSignature(root: string): string {
  const entries: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || entries.length >= MAX_FILES) return
    let names: import('node:fs').Dirent[]
    try { names = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of names) {
      if (IGNORED.has(entry.name) || entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.isFile() && SOURCE.test(entry.name)) { try { const s = statSync(full); entries.push(`${path.relative(root, full)}:${s.size}:${Math.floor(s.mtimeMs)}`) } catch { /* removed while scanning */ } }
    }
  }
  walk(root, 0)
  return entries.sort().join('|')
}

type Watching = { retry: boolean; roots: string[]; watchers: FSWatcher[]; signatures: Map<string, string>; timer: ReturnType<typeof setTimeout> | null; poll: ReturnType<typeof setInterval>; lastReload: number }
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerModWatch: Watching | undefined
}

export function modWatchEnabled(env: Record<string, string | undefined> = process.env): boolean { return env.AGENT_VIEWER_MODS_WATCH !== '0' }

/**
 * Start watching (once per process) the user's mods directory and every explicit
 * development directory. `roots` is asked again as directories are added or removed.
 */
export function ensureModWatcher(roots: () => readonly string[]): void {
  if (!modWatchEnabled()) return
  const current = globalThis.__agentViewerModWatch
  if (current) return
  const state: Watching = { retry: false, roots: [], watchers: [], signatures: new Map(), timer: null, lastReload: 0, poll: setInterval(() => sync(), ROOTS_POLL_MS) }
  state.poll.unref?.()
  globalThis.__agentViewerModWatch = state
  const fire = () => {
    state.timer = null
    let changed = false
    for (const root of state.roots) {
      const signature = modTreeSignature(root)
      if (state.signatures.get(root) !== signature) { state.signatures.set(root, signature); changed = true }
    }
    if (!changed) return
    const wait = state.lastReload + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) { state.timer = setTimeout(fire, wait); state.timer.unref?.(); return }
    state.lastReload = Date.now()
    try { requestModReload(readModReloadRequest().developmentDirs) } catch (error) { console.error('Mod auto-reload failed:', error) }
  }
  const schedule = () => { if (state.timer) clearTimeout(state.timer); state.timer = setTimeout(fire, DEBOUNCE_MS); state.timer.unref?.() }
  function sync() {
    const wanted = [...new Set(roots().map(root => path.resolve(root)))]
    if (!state.retry && wanted.length === state.roots.length && wanted.every((root, i) => root === state.roots[i])) return
    for (const watcher of state.watchers) watcher.close()
    state.watchers = []; state.roots = wanted; state.retry = false
    for (const root of wanted) {
      state.signatures.set(root, modTreeSignature(root))
      try {
        const watcher = watch(root, { recursive: true }, (_event, name) => { if (!name || (!String(name).split(path.sep).some(part => IGNORED.has(part)) && SOURCE.test(String(name)))) schedule() })
        watcher.on('error', () => { /* the directory went away; the next roots poll re-establishes it */ state.retry = true })
        watcher.unref?.()
        state.watchers.push(watcher)
      } catch { state.retry = true /* not watchable yet (missing, or recursive watching unsupported): the next roots poll retries, and an explicit reload still works */ }
    }
  }
  sync()
}

/** Stop watching (tests, and a process that is shutting down). */
export function stopModWatcher(): void {
  const state = globalThis.__agentViewerModWatch
  if (!state) return
  clearInterval(state.poll); if (state.timer) clearTimeout(state.timer)
  for (const watcher of state.watchers) watcher.close()
  globalThis.__agentViewerModWatch = undefined
}
