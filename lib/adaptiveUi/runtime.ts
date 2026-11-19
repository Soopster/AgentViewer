// The Adaptive UI's in-process state: the shape book and call usage the
// toolCard hook fills while the transcript is read, and the service a view
// reads it through. One instance per process on globalThis, because Next
// gives routes and the read path separate module instances.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdaptiveUiService, AdaptiveUiSnapshot } from '../plugins/adaptiveUi'
import { corpusProfileText, corpusSummary, loadCorpus, profileCoverage, scanHistory, type Corpus, type ToolCorpus } from './corpus'
import { createLocalHistorySource } from './historySource'
import { buildDesignPrompt, buildRefinePrompt } from './prompt'
import { DESIGN_DAILY_LIMIT, designCardWithModel, refineCardWithModel } from './design'
import { preferenceHint, readCardHistory } from './history'
import type { ModelAsk } from '../plugins/modelService'
import type { HistorySource, ScanOptions } from './corpus'
import { suggest, type InteractionCounts, type Suggestion, type ViewSuggestionSpec } from './suggest'
import { getConfiguredTuiCustomViews, setConfiguredTuiCustomViews } from '../tuiState'
import { ShapeBook, type ShapeRecord } from './shapes'
import { deleteCardRule, loadCardRules, loadEffectiveCardRules, recipesDir, setCardRuleStatus } from './store'
import { localPluginDiscovery } from '../plugins/localPlugins'
import { isPluginEnabled } from '../plugins/enablement'
import { clearPluginToolCardCache } from '../plugins/toolCards'

type Usage = { completed: number; failed: number }
type State = { autoBackground: boolean; autoAsk: ModelAsk | null; autoDraft: boolean; auto: { day: string; count: number }; autoFailed: Map<string, number>; autoRunning: boolean; corpus: Corpus | null; learning: Promise<string> | null; interactions: Map<string, InteractionCounts>; dismissed: Set<string>; model: { day: string; count: number }; fileStamp: number; book: ShapeBook; usage: Map<string, Usage>; dirty: boolean; timer: ReturnType<typeof setTimeout> | null; loaded: boolean }
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerAdaptiveUi: State | undefined
}
const stateFile = () => join(process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR || join(process.cwd(), '.agent-viewer-data', 'adaptive-ui'), 'state.json')
const USAGE_TOOLS_MAX = 300
export const AUTO_DRAFT_AFTER = 5
/** Automatic drafts per day, however many tools qualify: a model call each, so a ceiling the person can read. */
export const AUTO_DRAFT_DAILY = 3
const AUTO_FAILURE_COOLDOWN_MS = 60 * 60_000

function state(): State {
  const s = globalThis.__agentViewerAdaptiveUi ??= { autoBackground: true, autoAsk: null, autoDraft: false, auto: { day: '', count: 0 }, autoFailed: new Map(), autoRunning: false, corpus: null, learning: null, interactions: new Map(), dismissed: new Set(), model: { day: '', count: 0 }, fileStamp: 0, book: new ShapeBook(), usage: new Map(), dirty: false, timer: null, loaded: false }
  if (!s.loaded) {
    s.loaded = true
    readShapesFromDisk(s)
  }
  return s
}

function readShapesFromDisk(s: State): void {
  try {
    const raw = JSON.parse(readFileSync(stateFile(), 'utf8')) as { shapes?: ShapeRecord[]; model?: { day?: string; count?: number }; interactions?: Record<string, unknown>; dismissed?: unknown; autoDraft?: unknown; auto?: { day?: string; count?: number } }
    if (raw.model && typeof raw.model.day === 'string' && typeof raw.model.count === 'number' && (raw.model.day > s.model.day || (raw.model.day === s.model.day && raw.model.count > s.model.count))) s.model = { day: raw.model.day, count: raw.model.count }
    if (raw.interactions && typeof raw.interactions === 'object') for (const [tool, value] of Object.entries(raw.interactions)) { const mine = s.interactions.get(tool); const v = value as Partial<InteractionCounts>; const next = { expand: Number(v.expand) || 0, fold: Number(v.fold) || 0, toggle: Number(v.toggle) || 0 }; if (!mine || next.expand + next.fold + next.toggle > mine.expand + mine.fold + mine.toggle) s.interactions.set(tool, next) }
    if (typeof raw.autoDraft === 'boolean') s.autoDraft = raw.autoDraft
    if (raw.auto && typeof raw.auto.day === 'string' && typeof raw.auto.count === 'number' && raw.auto.day >= s.auto.day) s.auto = { day: raw.auto.day, count: Math.max(raw.auto.count, raw.auto.day === s.auto.day ? s.auto.count : 0) }
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
      writeFileSync(temp, JSON.stringify({ shapes: s.book.list(), model: s.model, interactions: Object.fromEntries(s.interactions), dismissed: [...s.dismissed].slice(-200), autoDraft: s.autoDraft, auto: s.auto }), { mode: 0o600 })
      renameSync(temp, file)
      s.fileStamp = statSync(file).mtimeMs
    } catch { /* a shape book that cannot be saved is lost on restart, nothing else */ }
  }, 2_000)
  s.timer.unref?.()
}

/** What past transcripts say, loaded once and refreshed after a scan. */
function corpusOf(s: State): Corpus { return s.corpus ??= loadCorpus() }
const toolHistory = (s: State, tool: string): ToolCorpus | undefined => corpusOf(s).tools[tool]

export function recordShape(input: Parameters<ShapeBook['record']>[0]): ShapeRecord {
  const s = state(); const record = s.book.record(input); schedulePersist(s)
  if (s.autoDraft && s.autoBackground) void autoDraftOnce()
  return record
}

/**
 * Opt-in: draft a card, unprompted, for a tool that has been drawn generically often enough. Never activates anything
 * (a draft only shows as a labelled preview beside the real call), at most AUTO_DRAFT_DAILY a day, one at a time, and a
 * tool whose design failed is left alone for an hour rather than retried on every call.
 */
export async function autoDraftOnce(ask?: ModelAsk, now = new Date()): Promise<string | null> {
  const s = state()
  if (!s.autoDraft || s.autoRunning) return null
  const day = now.toISOString().slice(0, 10)
  if (s.auto.day !== day) s.auto = { day, count: 0 }
  if (s.auto.count >= AUTO_DRAFT_DAILY) return null
  const ruled = new Set(effectiveRules().rules.filter(rule => rule.match.kind !== 'system').map(rule => rule.match.tool))
  const candidate = s.book.list().find(shape => !shape.dismissed && shape.count >= AUTO_DRAFT_AFTER && (shape.samples.length > 0 || toolHistory(s, shape.tool)?.samples.length) && !ruled.has(shape.tool) && now.getTime() - (s.autoFailed.get(shape.tool) ?? 0) > AUTO_FAILURE_COOLDOWN_MS)
  if (!candidate) return null
  s.autoRunning = true; s.auto.count++; schedulePersist(s)
  try { return await designHere(candidate.key, ask ?? s.autoAsk ?? undefined) }
  catch { s.autoFailed.set(candidate.tool, now.getTime()); s.auto.count = Math.max(0, s.auto.count - 1); return null }
  finally { s.autoRunning = false }
}

/** Test seam: what answers automatic drafts instead of the real model. */
export function setAutoDraftAsk(ask: ModelAsk | null, background = true): void { const s = state(); s.autoAsk = ask; s.autoBackground = background }

export function setAutoDraft(enabled: boolean): void { const s = state(); s.autoDraft = enabled; schedulePersist(s); if (enabled && s.autoBackground) void autoDraftOnce() }
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
  const suggestions = suggest({ shapes: s.book.list(), usage, interactions: Object.fromEntries(s.interactions), ruledTools: new Set(loaded.rules.filter(rule => rule.match.kind !== 'system').map(rule => rule.match.tool)), dismissed: s.dismissed, existingViewIds })
  const corpus = corpusOf(s)
  const knowledge = {
    scanned: Object.keys(corpus.scanned).length, updatedAt: corpus.updatedAt,
    tools: Object.fromEntries(Object.values(corpus.tools).map(tool => [tool.tool, corpusSummary(tool)])),
    ruleWarnings: Object.fromEntries(loaded.rules.flatMap(rule => { const found = profileCoverage(rule, corpus.tools[rule.match.tool]); const all = [...found.never, ...found.rare]; return all.length && rule.match.kind !== 'system' ? [[rule.id, all.slice(0, 4)] as const] : [] })),
  }
  return { dir: loaded.dir, knowledge, history: readCardHistory(loaded.dir, { limit: 40 }), rules: loaded.rules, origins: loaded.origins, invalid: loaded.invalid, shapes: s.book.list(), usage, suggestions, settings: { autoDraft: s.autoDraft, autoDraftAfter: AUTO_DRAFT_AFTER, autoDraftDaily: AUTO_DRAFT_DAILY } }
}

/** A suggested view becomes a new custom view, never the selected one, and never replaces one with its id. */
async function addSuggestedView(view: ViewSuggestionSpec): Promise<void> {
  const current = await getConfiguredTuiCustomViews()
  if (current.views.some(existing => existing.id === view.id)) throw new Error(`a view "${view.name}" already exists`)
  await setConfiguredTuiCustomViews({ views: [...current.views, { id: view.id, name: view.name, base: view.base, overrides: view.overrides as never }] })
}

/** Spend one of today's model questions, or refuse: a plugin may not spend without bound. */
function spendModelQuestion(s: State, now = new Date()): () => void {
  const day = now.toISOString().slice(0, 10)
  if (s.model.day !== day) s.model = { day, count: 0 }
  if (s.model.count >= DESIGN_DAILY_LIMIT) throw new Error(`today's limit of ${DESIGN_DAILY_LIMIT} designed cards is used; design one with an agent instead`)
  s.model.count += 1
  schedulePersist(s)
  // A question the model never answered (quota, network) is not one of today's.
  return () => { if (s.model.day === day && s.model.count > 0) { s.model.count -= 1; schedulePersist(s) } }
}

/** The shape's own samples first, then representative ones from history, without repeats, up to five. */
function withHistorySamples(shape: ShapeRecord, history: ToolCorpus | null): ShapeRecord['samples'] {
  const out = [...shape.samples]
  for (const sample of history?.samples ?? []) if (out.length < 5 && !out.some(entry => JSON.stringify(entry.input) === JSON.stringify(sample.input))) out.push(sample)
  return out
}

/** What this person's own decisions say about cards they like, once there are enough of them to say. */
function currentPreference(): string | null {
  const own = loadCardRules()
  return preferenceHint(readCardHistory(own.dir, { limit: 200 }), own.rules.filter(rule => rule.status === 'active').map(rule => (rule.blocks as readonly { type?: unknown }[]).map(block => String(block.type))))
}

/** Change one of the person's own rules from a plain-language instruction; the result is a draft. */
export async function refineHere(id: string, instruction: string, ask?: ModelAsk): Promise<string> {
  const s = state()
  const rule = loadCardRules().rules.find(entry => entry.id === id)
  if (!rule) throw new Error(`no card rule of yours named "${id.slice(0, 64)}"`)
  const refund = spendModelQuestion(s)
  const model = ask ?? (await import('../plugins/modelService')).askModel
  let asked = false
  const counted: ModelAsk = async input => { const reply = await model(input); asked = true; return reply }
  let next
  try { next = await refineCardWithModel(rule, instruction, counted) } catch (error) { if (!asked) refund(); throw error }
  clearPluginToolCardCache()
  return `${next.id} is now revision ${next.revision} and a draft: review it, then enable it`
}

/** Ask a tool-less model to design a card for a shape; the result is always a draft. */
export async function designHere(key: string, ask?: ModelAsk): Promise<string> {
  const s = state(); refreshFromDisk(s)
  const shape = s.book.get(key)
  if (!shape) throw new Error('that shape is no longer tracked')
  if (!shape.samples.length && !toolHistory(s, shape.tool)?.samples.length) throw new Error('no samples were kept for this tool yet: call it once more, learn from past sessions, or design it with an agent')
  const refund = spendModelQuestion(s)
  const model = ask ?? (await import('../plugins/modelService')).askModel
  let asked = false
  const counted: ModelAsk = async input => { try { const reply = await model(input); asked = true; return reply } catch (error) { throw error } }
  let rule
  const history = toolHistory(s, shape.tool) ?? null
  try { rule = await designCardWithModel({ ...shape, samples: withHistorySamples(shape, history) }, counted, { preference: currentPreference(), history, profile: history ? corpusProfileText(history) : null }) }
  catch (error) { if (!asked) refund(); throw error }
  clearPluginToolCardCache()
  return rule.id
}

/**
 * Read past sessions (a bounded batch, newest first) and fold their tool calls into the corpus, then make sure every
 * non-native tool history knows about appears in the gallery with what history saw. Safe to call again: only sessions
 * not read before are read, and two callers share one scan.
 */
export function learnFromHistory(source: HistorySource = createLocalHistorySource(), options: ScanOptions = { maxSessions: 40, deadlineMs: 25_000 }): Promise<string> {
  const s = state()
  if (s.learning) return s.learning
  const corpus = corpusOf(s)
  s.learning = (async () => {
    const report = await scanHistory(corpus, source, options)
    for (const tool of Object.values(corpus.tools)) {
      if (tool.calls < 2) continue
      const top = Object.entries(tool.keySets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
      s.book.seed({ tool: tool.tool, ...(tool.mcpServer ? { mcpServer: tool.mcpServer } : {}), inputKeys: top ? top.split(',') : [], count: tool.calls, firstSeen: tool.firstSeen, lastSeen: tool.lastSeen, samples: tool.samples.slice(0, 3) })
    }
    schedulePersist(s)
    const total = Object.keys(corpus.scanned).length
    return `Read ${report.scanned} past session${report.scanned === 1 ? '' : 's'} (${total} in all, ${report.remaining} still to read): ${report.calls} tool calls, ${report.tools} tools tracked${report.stopped === 'limit' || report.stopped === 'deadline' ? '. Run it again to read more' : ''}`
  })().finally(() => { s.learning = null })
  return s.learning
}

/** The native service: what a view calls where the read path runs (the web daemon, or the TUI itself). */
export const nativeAdaptiveUi: AdaptiveUiService = {
  async scan() { return adaptiveUiSnapshot(new Set((await getConfiguredTuiCustomViews()).views.map(view => view.id))) },
  async setStatus(id, status) { setCardRuleStatus(id, status); clearPluginToolCardCache() },
  async remove(id) { deleteCardRule(id); clearPluginToolCardCache() },
  async dismissShape(key, dismissed) { const s = state(); s.book.dismiss(key, dismissed); schedulePersist(s) },
  async designHere(key, ask) { return designHere(key, ask) },
  async learnFromHistory() { return learnFromHistory() },
  async setAutoDraft(enabled) { setAutoDraft(enabled) },
  async applySuggestion(id) {
    const views = new Set((await getConfiguredTuiCustomViews()).views.map(view => view.id))
    const suggestion: Suggestion | undefined = adaptiveUiSnapshot(views).suggestions.find(entry => entry.id === id)
    if (!suggestion) throw new Error('that suggestion no longer applies')
    if (suggestion.kind === 'view') { await addSuggestedView(suggestion.view); return `Added the view "${suggestion.view.name}". Pick it from the View menu.` }
    return `Use Design card on ${suggestion.tool}.`
  },
  async dismissSuggestion(id) { const s = state(); s.dismissed.add(id); schedulePersist(s) },
  async refineHere(id, instruction, ask) { return refineHere(id, instruction, ask) },
  async refinePrompt(id) {
    const rule = loadCardRules().rules.find(entry => entry.id === id)
    if (!rule) throw new Error(`no card rule of yours named "${id.slice(0, 64)}"`)
    return buildRefinePrompt(rule, recipesDir())
  },
  async designPrompt(key) {
    const s = state(); refreshFromDisk(s)
    const shape = s.book.get(key)
    if (!shape) throw new Error('that shape is no longer tracked')
    const history = toolHistory(state(), shape.tool) ?? null
    return buildDesignPrompt({ ...shape, samples: withHistorySamples(shape, history) }, recipesDir(), currentPreference(), history ? corpusProfileText(history) : null)
  },
}
