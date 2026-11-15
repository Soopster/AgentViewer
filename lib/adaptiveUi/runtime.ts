// The Adaptive UI's in-process state: the shape book and call usage the
// toolCard hook fills while the transcript is read, and the service a view
// reads it through. One instance per process on globalThis, because Next
// gives routes and the read path separate module instances.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdaptiveUiService, AdaptiveUiSnapshot } from '../plugins/adaptiveUi'
import { buildDesignPrompt } from './prompt'
import { ShapeBook, type ShapeRecord } from './shapes'
import { deleteCardRule, loadCardRules, recipesDir, setCardRuleStatus } from './store'
import { clearPluginToolCardCache } from '../plugins/toolCards'

type Usage = { completed: number; failed: number }
type State = { fileStamp: number; book: ShapeBook; usage: Map<string, Usage>; dirty: boolean; timer: ReturnType<typeof setTimeout> | null; loaded: boolean }
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerAdaptiveUi: State | undefined
}
const stateFile = () => join(process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR || join(process.cwd(), '.agent-viewer-data', 'adaptive-ui'), 'state.json')
const USAGE_TOOLS_MAX = 300
const AUTO_DRAFT_AFTER = 5

function state(): State {
  const s = globalThis.__agentViewerAdaptiveUi ??= { fileStamp: 0, book: new ShapeBook(), usage: new Map(), dirty: false, timer: null, loaded: false }
  if (!s.loaded) {
    s.loaded = true
    readShapesFromDisk(s)
  }
  return s
}

function readShapesFromDisk(s: State): void {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as { shapes?: ShapeRecord[] }
    s.book.merge(Array.isArray(raw.shapes) ? raw.shapes.filter(shape => shape && typeof shape.key === 'string' && typeof shape.tool === 'string' && Array.isArray(shape.inputKeys)) : [])
    s.fileStamp = statSync(stateFile()).mtimeMs
  } catch { /* first run, or an unreadable file: start empty */ }
}

/**
 * The TUI reads transcripts in a worker isolate and draws this view in the main one; each has its
 * own shape book, joined only through the state file. Before showing the book, fold in what the
 * other isolate has persisted since this one last looked.
 */
function refreshFromDisk(s: State): void {
  try { if (statSync(stateFile()).mtimeMs !== s.fileStamp) readShapesFromDisk(s) } catch { /* no file yet */ }
}

/** Persist soon, at most once every 2s: a poll must not write per call. */
function schedulePersist(s: State): void {
  s.dirty = true
  if (s.timer) return
  s.timer = setTimeout(() => {
    s.timer = null
    if (!s.dirty) return
    s.dirty = false
    try {
      const file = stateFile()
      mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 })
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, JSON.stringify({ shapes: s.book.list() }), { mode: 0o600 })
      renameSync(temp, file)
      s.fileStamp = statSync(file).mtimeMs
    } catch { /* a shape book that cannot be saved is lost on restart, nothing else */ }
  }, 2_000)
  s.timer.unref?.()
}

export function recordShape(input: Parameters<ShapeBook['record']>[0]): ShapeRecord { const s = state(); const record = s.book.record(input); schedulePersist(s); return record }
export function noteToolCompleted(tool: string, failed: boolean): void {
  const s = state()
  const usage = s.usage.get(tool) ?? { completed: 0, failed: 0 }
  usage.completed += 1; if (failed) usage.failed += 1
  s.usage.delete(tool); s.usage.set(tool, usage)
  while (s.usage.size > USAGE_TOOLS_MAX) s.usage.delete(s.usage.keys().next().value!)
}

export function adaptiveUiSnapshot(): AdaptiveUiSnapshot {
  const s = state(); refreshFromDisk(s)
  const loaded = loadCardRules()
  return { dir: loaded.dir, rules: loaded.rules, invalid: loaded.invalid, shapes: s.book.list(), usage: [...s.usage].map(([tool, u]) => ({ tool, ...u })).sort((a, b) => b.completed - a.completed).slice(0, 50), settings: { autoDraft: false, autoDraftAfter: AUTO_DRAFT_AFTER } }
}

/** The native service: what a view calls where the read path runs (the web daemon, or the TUI itself). */
export const nativeAdaptiveUi: AdaptiveUiService = {
  async scan() { return adaptiveUiSnapshot() },
  async setStatus(id, status) { setCardRuleStatus(id, status); clearPluginToolCardCache() },
  async remove(id) { deleteCardRule(id); clearPluginToolCardCache() },
  async dismissShape(key, dismissed) { const s = state(); s.book.dismiss(key, dismissed); schedulePersist(s) },
  async designPrompt(key) {
    const s = state(); refreshFromDisk(s)
    const shape = s.book.get(key)
    if (!shape) throw new Error('that shape is no longer tracked')
    return buildDesignPrompt(shape, recipesDir())
  },
}
