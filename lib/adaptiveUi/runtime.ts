// The Adaptive UI's in-process state: the shape book and call usage the
// toolCard hook fills while the transcript is read, and the service a view
// reads it through. One instance per process on globalThis, because Next
// gives routes and the read path separate module instances.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdaptiveUiService, AdaptiveUiSnapshot } from '../plugins/adaptiveUi'
import { buildDesignPrompt } from './prompt'
import { DESIGN_DAILY_LIMIT, designCardWithModel } from './design'
import type { ModelAsk } from '../plugins/modelService'
import { suggest, type InteractionCounts, type Suggestion, type ViewSuggestionSpec } from './suggest'
import { getConfiguredTuiCustomViews, setConfiguredTuiCustomViews } from '../tuiState'
import { ShapeBook, type ShapeRecord } from './shapes'
import { deleteCardRule, loadEffectiveCardRules, recipesDir, setCardRuleStatus } from './store'
import { localPluginDiscovery } from '../plugins/localPlugins'
import { isPluginEnabled } from '../plugins/enablement'
import { clearPluginToolCardCache } from '../plugins/toolCards'

type Usage = { completed: number; failed: number }
type State = { interactions: Map<string, InteractionCounts>; dismissed: Set<string>; model: { day: string; count: number }; fileStamp: number; book: ShapeBook; usage: Map<string, Usage>; dirty: boolean; timer: ReturnType<typeof setTimeout> | null; loaded: boolean }
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerAdaptiveUi: State | undefined
}
const stateFile = () => join(process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR || join(process.cwd(), '.agent-viewer-data', 'adaptive-ui'), 'state.json')
const USAGE_TOOLS_MAX = 300
const AUTO_DRAFT_AFTER = 5

function state(): State {
  const s = globalThis.__agentViewerAdaptiveUi ??= { interactions: new Map(), dismissed: new Set(), model: { day: '', count: 0 }, fileStamp: 0, book: new ShapeBook(), usage: new Map(), dirty: false, timer: null, loaded: false }
  if (!s.loaded) {
    s.loaded = true
    readShapesFromDisk(s)
  }
  return s
}

function readShapesFromDisk(s: State): void {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as { shapes?: ShapeRecord[]; model?: { day?: string; count?: number }; interactions?: Record<string, unknown>; dismissed?: unknown }
    if (raw.model && typeof raw.model.day === 'string' && typeof raw.model.count === 'number' && (raw.model.day > s.model.day || (raw.model.day === s.model.day && raw.model.count > s.model.count))) s.model = { day: raw.model.day, count: raw.model.count }
    if (raw.interactions && typeof raw.interactions === 'object') for (const [tool, value] of Object.entries(raw.interactions)) { const mine = s.interactions.get(tool); const v = value as Partial<InteractionCounts>; const next = { expand: Number(v.expand) || 0, fold: Number(v.fold) || 0, toggle: Number(v.toggle) || 0 }; if (!mine || next.expand + next.fold + next.toggle > mine.expand + mine.fold + mine.toggle) s.interactions.set(tool, next) }
    if (Array.isArray(raw.dismissed)) for (const id of raw.dismissed) if (typeof id === 'string' && id.length <= 300) s.dismissed.add(id)
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
      writeFileSync(temp, JSON.stringify({ shapes: s.book.list(), model: s.model, interactions: Object.fromEntries(s.interactions), dismissed: [...s.dismissed].slice(-200) }), { mode: 0o600 })
      renameSync(temp, file)
      s.fileStamp = statSync(file).mtimeMs
    } catch { /* a shape book that cannot be saved is lost on restart, nothing else */ }
  }, 2_000)
  s.timer.unref?.()
}

export function recordShape(input: Parameters<ShapeBook['record']>[0]): ShapeRecord { const s = state(); const record = s.book.record(input); schedulePersist(s); return record }
export function noteInteraction(tool: string, action: 'expand' | 'fold' | 'toggle' | 'view-switch', count: number): void {
  if (action === 'view-switch') return
  const s = state(), counts = s.interactions.get(tool) ?? { expand: 0, fold: 0, toggle: 0 }
  counts[action] += count
  s.interactions.delete(tool); s.interactions.set(tool, counts)
  while (s.interactions.size > USAGE_TOOLS_MAX) s.interactions.delete(s.interactions.keys().next().value!)
  schedulePersist(s)
}
export function noteToolCompleted(tool: string, failed: boolean): void {
  const s = state()
  const usage = s.usage.get(tool) ?? { completed: 0, failed: 0 }
  usage.completed += 1; if (failed) usage.failed += 1
  s.usage.delete(tool); s.usage.set(tool, usage)
  while (s.usage.size > USAGE_TOOLS_MAX) s.usage.delete(s.usage.keys().next().value!)
}

/** The rules in force: the person's, plus those of enabled mods that ship a `ui-recipes/` folder. */
export function effectiveRules() {
  let mods: { id: string; dir: string }[] = []
  try { mods = localPluginDiscovery().plugins.filter(plugin => isPluginEnabled(plugin.manifest.id)).map(plugin => ({ id: plugin.manifest.id, dir: plugin.dir })) } catch { /* discovery unavailable: the person's own rules still apply */ }
  return loadEffectiveCardRules(mods)
}

export function adaptiveUiSnapshot(existingViewIds: ReadonlySet<string> = new Set()): AdaptiveUiSnapshot {
  const s = state(); refreshFromDisk(s)
  const loaded = effectiveRules()
  const usage = [...s.usage].map(([tool, u]) => ({ tool, ...u })).sort((a, b) => b.completed - a.completed).slice(0, 50)
  const suggestions = suggest({ shapes: s.book.list(), usage, interactions: Object.fromEntries(s.interactions), ruledTools: new Set(loaded.rules.map(rule => rule.match.tool)), dismissed: s.dismissed, existingViewIds })
  return { dir: loaded.dir, rules: loaded.rules, origins: loaded.origins, invalid: loaded.invalid, shapes: s.book.list(), usage, suggestions, settings: { autoDraft: false, autoDraftAfter: AUTO_DRAFT_AFTER } }
}

/** A suggested view becomes a new custom view, never the selected one, and never replaces one with its id. */
async function addSuggestedView(view: ViewSuggestionSpec): Promise<void> {
  const current = await getConfiguredTuiCustomViews()
  if (current.views.some(existing => existing.id === view.id)) throw new Error(`a view "${view.name}" already exists`)
  await setConfiguredTuiCustomViews({ views: [...current.views, { id: view.id, name: view.name, base: view.base, overrides: view.overrides as never }] })
}

/** Spend one of today's model questions, or refuse: a plugin may not spend without bound. */
function spendModelQuestion(s: State, now = new Date()): void {
  const day = now.toISOString().slice(0, 10)
  if (s.model.day !== day) s.model = { day, count: 0 }
  if (s.model.count >= DESIGN_DAILY_LIMIT) throw new Error(`today's limit of ${DESIGN_DAILY_LIMIT} designed cards is used; design one with an agent instead`)
  s.model.count += 1
  schedulePersist(s)
}

/** Ask a tool-less model to design a card for a shape; the result is always a draft. */
export async function designHere(key: string, ask?: ModelAsk): Promise<string> {
  const s = state(); refreshFromDisk(s)
  const shape = s.book.get(key)
  if (!shape) throw new Error('that shape is no longer tracked')
  if (!shape.samples.length) throw new Error('no samples were kept for this tool yet: call it once more, or design it with an agent')
  spendModelQuestion(s)
  const model = ask ?? (await import('../plugins/modelService')).askModel
  const rule = await designCardWithModel(shape, model)
  clearPluginToolCardCache()
  return rule.id
}

/** The native service: what a view calls where the read path runs (the web daemon, or the TUI itself). */
export const nativeAdaptiveUi: AdaptiveUiService = {
  async scan() { return adaptiveUiSnapshot(new Set((await getConfiguredTuiCustomViews()).views.map(view => view.id))) },
  async setStatus(id, status) { setCardRuleStatus(id, status); clearPluginToolCardCache() },
  async remove(id) { deleteCardRule(id); clearPluginToolCardCache() },
  async dismissShape(key, dismissed) { const s = state(); s.book.dismiss(key, dismissed); schedulePersist(s) },
  async designHere(key, ask) { return designHere(key, ask) },
  async applySuggestion(id) {
    const views = new Set((await getConfiguredTuiCustomViews()).views.map(view => view.id))
    const suggestion: Suggestion | undefined = adaptiveUiSnapshot(views).suggestions.find(entry => entry.id === id)
    if (!suggestion) throw new Error('that suggestion no longer applies')
    if (suggestion.kind === 'view') { await addSuggestedView(suggestion.view); return `Added the view "${suggestion.view.name}". Pick it from the View menu.` }
    return `Use Design card on ${suggestion.tool}.`
  },
  async dismissSuggestion(id) { const s = state(); s.dismissed.add(id); schedulePersist(s) },
  async designPrompt(key) {
    const s = state(); refreshFromDisk(s)
    const shape = s.book.get(key)
    if (!shape) throw new Error('that shape is no longer tracked')
    return buildDesignPrompt(shape, recipesDir())
  },
}
