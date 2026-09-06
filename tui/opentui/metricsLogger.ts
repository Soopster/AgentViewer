// Opt-in OpenTUI metrics capture for later performance/memory analysis.
// Enable with AGENT_VIEWER_TUI_METRICS=1 (sample interval via
// AGENT_VIEWER_TUI_METRICS_INTERVAL, default 15s; output path via
// AGENT_VIEWER_TUI_METRICS_LOG, default .agent-viewer-data/tui-metrics.jsonl).
//
// A fullscreen TUI can't write to stdout/stderr without corrupting the render
// (see the AGENT_VIEWER_PERF frame-timing canary below in App.tsx for the same
// constraint), so samples are appended as JSONL — one JSON object per line,
// trivial to load with jq/pandas/etc. for offline analysis.
//
// Each sample captures:
//  - process memory (rss/heap/external/arrayBuffers)
//  - Bun's JSC heap stats via `bun:jsc` — objectCount and protectedObjectCount
//    are the strongest signal for a JS-side leak (protected objects are roots
//    the GC cannot collect; a steadily growing count means something is being
//    retained that shouldn't be)
//  - event-loop delay histogram (mean/p50/p99/max), reset each interval so
//    samples show per-window behavior rather than a lifetime average
//  - GC pressure (count/total/max ms per generation), also reset each interval
//  - render-frame summary (commits, frames over the 120fps budget, slowest),
//    fed by noteRenderFrame() from the existing render canary in App.tsx
//  - app-level gauges (session counts, cache/map sizes, queue depths) supplied
//    by registerTuiMetricsGauge — App.tsx and worker clients register reporters
//    for the structures most likely to grow unbounded
//
// Zero cost when disabled: noteRenderFrame/registerTuiMetricsGauge are no-ops
// (registerTuiMetricsGauge still returns an unregister fn so call sites don't
// need to branch), and nothing samples, monitors, or writes.

import { appendFile, appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { monitorEventLoopDelay, PerformanceObserver, type IntervalHistogram } from 'node:perf_hooks'
import { PerfStats } from '../../lib/perfStats'
import type { AgentProvider } from '../../lib/types'
import { TUI_FRAME_BUDGET_MS } from './performanceBudget'

const METRICS_ENABLED = process.env.AGENT_VIEWER_TUI_METRICS === '1'
const METRICS_PATH = process.env.AGENT_VIEWER_TUI_METRICS_LOG
  ?? join(process.cwd(), '.agent-viewer-data', 'tui-metrics.jsonl')
const METRICS_INTERVAL_SEC = Math.max(
  5,
  Number.parseInt(process.env.AGENT_VIEWER_TUI_METRICS_INTERVAL ?? '', 10) || 15,
)
// Forces a full GC immediately before each sample so heap readings reflect
// live (post-collection) retained memory rather than whatever garbage hasn't
// been swept yet — much clearer signal for spotting leaks, at the cost of an
// extra GC pause every interval. Off by default; opt in with =1 when hunting
// a specific leak.
const FORCE_GC_BEFORE_SAMPLE = process.env.AGENT_VIEWER_TUI_METRICS_GC === '1'

export function tuiMetricsEnabled(): boolean {
  return METRICS_ENABLED
}

// ── Bun-specific hooks ───────────────────────────────────────────────────────
// `Bun` and `bun:jsc` aren't in @types/node (no bun-types dependency here), and
// the legacy Ink TUI runs under plain Node — so everything here is resolved at
// runtime through globalThis/dynamic import and typed locally, never imported
// statically.

interface BunHeapStats {
  heapSize: number
  heapCapacity: number
  extraMemorySize: number
  objectCount: number
  protectedObjectCount: number
  globalObjectCount: number
  protectedGlobalObjectCount: number
}

interface BunJsc {
  heapStats: () => BunHeapStats
}

interface BunGlobal {
  gc: (force?: boolean) => void
}

function bunGlobal(): BunGlobal | null {
  const candidate = (globalThis as Record<string, unknown>).Bun
  if (candidate && typeof (candidate as BunGlobal).gc === 'function') return candidate as BunGlobal
  return null
}

let bunJsc: BunJsc | null | undefined
async function loadBunJsc(): Promise<BunJsc | null> {
  if (bunJsc !== undefined) return bunJsc
  try {
    // Non-literal specifier: resolves at runtime under Bun, and tsc treats a
    // non-literal dynamic import as `Promise<any>` rather than trying (and
    // failing) to resolve the module at type-check time.
    const specifier: string = 'bun:jsc'
    bunJsc = (await import(specifier)) as BunJsc
  } catch {
    bunJsc = null // not running under Bun (e.g. legacy Ink TUI under Node)
  }
  return bunJsc
}

// ── Event-loop delay + GC monitors ───────────────────────────────────────────
// Same approach as lib/telemetry.ts (server side), reset every sample so each
// line reflects that interval rather than a cumulative lifetime average.

type GcStat = { count: number; totalMs: number; maxMs: number }
const GC_KIND_LABEL: Record<number, string> = {
  1: 'minor',
  2: 'major',
  4: 'incremental',
  8: 'weakcb',
}

let loopDelay: IntervalHistogram | undefined
let gcByKind: Map<number, GcStat> | undefined

function ns2ms(ns: number): number {
  return Math.round((ns / 1e6) * 10) / 10
}

function startMonitors(): void {
  try {
    loopDelay = monitorEventLoopDelay({ resolution: 20 })
    loopDelay.enable()
  } catch { /* not supported under this runtime — sample omits loopDelay */ }
  try {
    gcByKind = new Map()
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const kind = (entry as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind ?? 0
        const stat = gcByKind!.get(kind) ?? { count: 0, totalMs: 0, maxMs: 0 }
        stat.count += 1
        stat.totalMs += entry.duration
        if (entry.duration > stat.maxMs) stat.maxMs = entry.duration
        gcByKind!.set(kind, stat)
      }
    })
    obs.observe({ entryTypes: ['gc'] })
  } catch { /* gc timing unavailable — sample omits gc */ }
}

// ── Render-frame rollup ──────────────────────────────────────────────────────
// Fed by the existing render canary in App.tsx (renderStartRef / useEffect),
// independent of the AGENT_VIEWER_PERF text-log path — both can run at once.

const frameWindow = { commits: 0, overBudget: 0, maxMs: 0 }
const composerLatencyStats = new PerfStats()

export function noteRenderFrame(durationMs: number): void {
  if (!METRICS_ENABLED) return
  frameWindow.commits += 1
  if (durationMs > TUI_FRAME_BUDGET_MS) frameWindow.overBudget += 1
  if (durationMs > frameWindow.maxMs) frameWindow.maxMs = durationMs
}

export function noteTuiComposerLatency(
  provider: AgentProvider,
  phase: 'send-to-ack' | 'first-output',
  durationMs: number,
): void {
  if (!METRICS_ENABLED || !Number.isFinite(durationMs) || durationMs < 0) return
  composerLatencyStats.record(`composer.${provider}.${phase}`, durationMs)
}

// Session-navigation latency, recorded by App.tsx around the sidebar open path.
// `select-to-open` is the debounce the selection waits out; `open-to-detail` is
// the worker read (0 on a cache hit); `select-to-paint` is the number the user
// actually feels — keypress to the new transcript being on screen.
const navLatencyStats = new PerfStats()

export function noteTuiNavLatency(
  phase: 'select-to-open' | 'open-to-detail' | 'detail-to-paint' | 'select-to-paint',
  durationMs: number,
): void {
  if (!METRICS_ENABLED || !Number.isFinite(durationMs) || durationMs < 0) return
  navLatencyStats.record(`nav.${phase}`, durationMs)
}

function drainFrameWindow(): { commits: number; overBudget: number; maxMs: number } {
  const snapshot = { ...frameWindow }
  frameWindow.commits = 0
  frameWindow.overBudget = 0
  frameWindow.maxMs = 0
  return snapshot
}

// ── App-level gauges ─────────────────────────────────────────────────────────
// Counts/sizes that the UI owns (session lists, per-session caches, worker
// queues) and that the logger can't see on its own. Reporters run on a timer,
// not a render — keep them cheap (Map.size, array.length; no array copies).

type GaugeReporter = () => Record<string, number>
const gaugeReporters = new Set<GaugeReporter>()

export function registerTuiMetricsGauge(reporter: GaugeReporter): () => void {
  if (METRICS_ENABLED) gaugeReporters.add(reporter)
  return () => { gaugeReporters.delete(reporter) }
}

function collectGauges(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const reporter of gaugeReporters) {
    try { Object.assign(out, reporter()) } catch { /* one bad reporter shouldn't drop the sample */ }
  }
  return out
}

// ── Card-recompute profiling (set AGENT_VIEWER_TUI_CARD_PROFILE=1) ───────────
// Targeted instrumentation for the live-streaming render path. The transcript
// pipeline is transcriptCards → stableCardData → cardDisplayData, each a
// useMemo with a WeakMap cache keyed by card *object reference*. During
// streaming, transcriptCards rebuilds live cards as fresh objects every delta
// (formatTranscriptCard returns new objects, and the `live:${uuid}` card itself
// is a new object each rebuild) — so every streamed token can cascade into a
// full cache miss for stableCardData and cardDisplayData, redoing
// renderedBodyLines/cardDiffView/headerMeta work for cards that haven't
// actually changed. This answers "how much recomputes per delta" directly,
// instead of inferring it from frame timings.
//
// Logged independently of AGENT_VIEWER_TUI_METRICS (own flag, own file —
// useful to turn on alone when chasing this specific path) as JSONL to
// .agent-viewer-data/tui-card-profile.jsonl (override via
// AGENT_VIEWER_TUI_CARD_PROFILE_LOG).
const CARD_PROFILE = process.env.AGENT_VIEWER_TUI_CARD_PROFILE === '1'
const CARD_PROFILE_PATH = process.env.AGENT_VIEWER_TUI_CARD_PROFILE_LOG
  ?? join(process.cwd(), '.agent-viewer-data', 'tui-card-profile.jsonl')

let cardProfileReady = false
let cardProfileBuffer = ''
let cardProfileFlushTimer: ReturnType<typeof setTimeout> | null = null
function ensureCardProfileFile(): void {
  if (cardProfileReady || !CARD_PROFILE) return
  cardProfileReady = true
  try { mkdirSync(dirname(CARD_PROFILE_PATH), { recursive: true }) } catch { /* logging is best-effort */ }
  console.log(`[tui-card-profile] enabled → ${CARD_PROFILE_PATH}`)
}

function scheduleCardProfileFlush(): void {
  if (cardProfileFlushTimer !== null) return
  cardProfileFlushTimer = setTimeout(() => {
    cardProfileFlushTimer = null
    const pending = cardProfileBuffer
    cardProfileBuffer = ''
    if (!pending) return
    appendFile(CARD_PROFILE_PATH, pending, () => { /* profiling is best-effort */ })
  }, 50)
  if (typeof cardProfileFlushTimer === 'object' && cardProfileFlushTimer && 'unref' in cardProfileFlushTimer) {
    cardProfileFlushTimer.unref()
  }
}

export function cardProfileEnabled(): boolean {
  return CARD_PROFILE
}

export function logCardRecompute(sample: {
  scope: 'transcriptCards' | 'stableCardData' | 'cardDisplayData'
  totalCards: number
  recomputed: number
  liveCards: number
  durationMs: number
}): void {
  if (!CARD_PROFILE) return
  ensureCardProfileFile()
  const line = {
    ts: new Date().toISOString(),
    scope: sample.scope,
    totalCards: sample.totalCards,
    recomputed: sample.recomputed,
    cacheHits: sample.totalCards - sample.recomputed,
    liveCards: sample.liveCards,
    durationMs: Math.round(sample.durationMs * 100) / 100,
  }
  cardProfileBuffer += JSON.stringify(line) + '\n'
  scheduleCardProfileFlush()
}

// ── Sampler ──────────────────────────────────────────────────────────────────

let started = false

export function startTuiMetricsLogger(): void {
  if (started || !METRICS_ENABLED) return
  started = true

  try { mkdirSync(dirname(METRICS_PATH), { recursive: true }) } catch { /* logging is best-effort */ }
  startMonitors()
  console.log(`[tui-metrics] enabled — sampling every ${METRICS_INTERVAL_SEC}s → ${METRICS_PATH}`)

  const startedAt = performance.now()
  const bun = bunGlobal()

  const tick = async () => {
    if (FORCE_GC_BEFORE_SAMPLE && bun) {
      try { bun.gc(true) } catch { /* best-effort */ }
    }

    const mem = process.memoryUsage()
    const sample: Record<string, unknown> = {
      ts: new Date().toISOString(),
      uptimeSec: Math.round((performance.now() - startedAt) / 100) / 10,
      mem: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
    }

    const jsc = await loadBunJsc()
    if (jsc) {
      try {
        const h = jsc.heapStats()
        sample.bunHeap = {
          heapSize: h.heapSize,
          heapCapacity: h.heapCapacity,
          extraMemorySize: h.extraMemorySize,
          objectCount: h.objectCount,
          protectedObjectCount: h.protectedObjectCount,
          globalObjectCount: h.globalObjectCount,
        }
      } catch { /* heap stats unavailable this tick */ }
    }

    if (loopDelay) {
      sample.loopDelay = {
        meanMs: ns2ms(loopDelay.mean),
        p50Ms: ns2ms(loopDelay.percentile(50)),
        p99Ms: ns2ms(loopDelay.percentile(99)),
        maxMs: ns2ms(loopDelay.max),
      }
      loopDelay.reset()
    }

    if (gcByKind && gcByKind.size > 0) {
      sample.gc = [...gcByKind.entries()].map(([kind, stat]) => ({
        kind: GC_KIND_LABEL[kind] ?? `kind-${kind}`,
        count: stat.count,
        totalMs: Math.round(stat.totalMs),
        maxMs: Math.round(stat.maxMs * 10) / 10,
      }))
      gcByKind.clear()
    }

    sample.frames = drainFrameWindow()

    const composerLatency = composerLatencyStats.snapshot()
    if (composerLatency.length > 0) sample.composerLatency = composerLatency

    const navLatency = navLatencyStats.snapshot()
    if (navLatency.length > 0) sample.navLatency = navLatency

    const gauges = collectGauges()
    if (Object.keys(gauges).length > 0) sample.gauges = gauges

    try {
      appendFileSync(METRICS_PATH, JSON.stringify(sample) + '\n')
    } catch { /* never break the UI for logging */ }
  }

  void tick()
  const handle = setInterval(() => { void tick() }, METRICS_INTERVAL_SEC * 1000)
  if (typeof handle === 'object' && handle && 'unref' in handle) {
    (handle as { unref: () => void }).unref()
  }
}
