// Local-debug telemetry: V8 heap snapshots, CPU profiles, event-loop delay, GC
// pressure, heap-space breakdown, plus the perf/diagnostics rollups. Gated
// behind AGENT_VIEWER_DIAG=1 so it is never exposed by default.
//
// State that the continuous monitors write to (event-loop histogram, GC stats)
// lives on globalThis because Next runs instrumentation.ts and route handlers
// in separate module instances — the endpoint must read what the monitor wrote.

import v8 from 'node:v8'
import { monitorEventLoopDelay, PerformanceObserver, type IntervalHistogram } from 'node:perf_hooks'
import { Session } from 'node:inspector'
import { getServerPerfStats } from './perfLog'
import { collectRuntimeDiagnostics } from './runtimeDiagnostics'

export function diagnosticsEnabled(): boolean {
  return process.env.AGENT_VIEWER_DIAG === '1'
}

type GcStat = { count: number; totalMs: number; maxMs: number }
type TelemetryState = {
  loopDelay?: IntervalHistogram
  gcByKind: Map<number, GcStat>
  gcObserver?: PerformanceObserver
  startedAt: number
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerTelemetry: TelemetryState | undefined
}

function state(): TelemetryState {
  return (globalThis.__agentViewerTelemetry ??= { gcByKind: new Map(), startedAt: Date.now() })
}

const GC_KIND_LABEL: Record<number, string> = {
  1: 'minor', // GCKind.kMinorGC (scavenge)
  2: 'major', // kMajorGC (mark-sweep-compact)
  4: 'incremental',
  8: 'weakcb',
}

// Start the continuous monitors. Idempotent and process-wide (the event loop
// and GC are singletons), so it is safe to call from both instrumentation and
// a lazy route path; the first caller wins.
export function initTelemetry(): void {
  const s = state()
  if (!s.loopDelay) {
    try {
      const h = monitorEventLoopDelay({ resolution: 20 })
      h.enable()
      s.loopDelay = h
    } catch { /* not supported — other telemetry still works */ }
  }
  if (!s.gcObserver) {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const kind = (entry as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind ?? 0
          const stat = s.gcByKind.get(kind) ?? { count: 0, totalMs: 0, maxMs: 0 }
          stat.count += 1
          stat.totalMs += entry.duration
          if (entry.duration > stat.maxMs) stat.maxMs = entry.duration
          s.gcByKind.set(kind, stat)
        }
      })
      obs.observe({ entryTypes: ['gc'] })
      s.gcObserver = obs
    } catch { /* gc timing unavailable */ }
  }
}

function ns2ms(ns: number): number {
  return Math.round((ns / 1e6) * 10) / 10
}

export function eventLoopDelaySummary(): Record<string, number> | null {
  const h = state().loopDelay
  if (!h) return null
  return {
    meanMs: ns2ms(h.mean),
    p50Ms: ns2ms(h.percentile(50)),
    p99Ms: ns2ms(h.percentile(99)),
    maxMs: ns2ms(h.max),
  }
}

export function gcSummary(): Array<{ kind: string; count: number; totalMs: number; maxMs: number }> {
  const out: Array<{ kind: string; count: number; totalMs: number; maxMs: number }> = []
  for (const [kind, stat] of state().gcByKind) {
    out.push({
      kind: GC_KIND_LABEL[kind] ?? `kind-${kind}`,
      count: stat.count,
      totalMs: Math.round(stat.totalMs),
      maxMs: Math.round(stat.maxMs * 10) / 10,
    })
  }
  return out.sort((a, b) => b.totalMs - a.totalMs)
}

function bytesToMb(b: number): number {
  return Math.round((b / 1024 / 1024) * 10) / 10
}

// Full JSON telemetry blob for the /api/diagnostics/runtime endpoint.
export function collectTelemetry(): Record<string, unknown> {
  initTelemetry()
  const mem = process.memoryUsage()
  const heap = v8.getHeapStatistics()
  const spaces = v8.getHeapSpaceStatistics().map((s) => ({
    space: s.space_name,
    usedMb: bytesToMb(s.space_used_size),
    sizeMb: bytesToMb(s.space_size),
    availableMb: bytesToMb(s.space_available_size),
  }))
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMb: bytesToMb(mem.rss),
      heapUsedMb: bytesToMb(mem.heapUsed),
      heapTotalMb: bytesToMb(mem.heapTotal),
      externalMb: bytesToMb(mem.external),
      arrayBuffersMb: bytesToMb(mem.arrayBuffers),
    },
    v8Heap: {
      heapSizeLimitMb: bytesToMb(heap.heap_size_limit),
      totalHeapSizeMb: bytesToMb(heap.total_heap_size),
      usedHeapSizeMb: bytesToMb(heap.used_heap_size),
      mallocedMb: bytesToMb(heap.malloced_memory),
      nativeContexts: heap.number_of_native_contexts,
      detachedContexts: heap.number_of_detached_contexts,
    },
    heapSpaces: spaces,
    eventLoopDelay: eventLoopDelaySummary(),
    gc: gcSummary(),
    caches: collectRuntimeDiagnostics(),
    perf: getServerPerfStats(),
  }
}

// Stream a V8 heap snapshot as the HTTP response body (loadable directly in
// Chrome DevTools → Memory → Load). Streaming avoids buffering the (often
// hundreds-of-MB) snapshot in memory or filling disk.
export function heapSnapshotStream(): ReadableStream<Uint8Array> {
  const nodeStream = v8.getHeapSnapshot()
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer | string) => {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : new Uint8Array(chunk))
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
    cancel() {
      nodeStream.destroy()
    },
  })
}

// Capture a CPU profile for `durationMs` and return it as a .cpuprofile JSON
// string (loadable in Chrome DevTools → Performance → Load profile).
export function captureCpuProfile(durationMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const session = new Session()
    try {
      session.connect()
    } catch (err) {
      reject(err)
      return
    }
    const cleanup = () => {
      try { session.disconnect() } catch { /* already gone */ }
    }
    session.post('Profiler.enable', (enableErr) => {
      if (enableErr) { cleanup(); reject(enableErr); return }
      session.post('Profiler.start', (startErr) => {
        if (startErr) { cleanup(); reject(startErr); return }
        const timer = setTimeout(() => {
          session.post('Profiler.stop', (stopErr, result) => {
            cleanup()
            if (stopErr) { reject(stopErr); return }
            resolve(JSON.stringify(result.profile))
          })
        }, durationMs)
        if (typeof timer === 'object' && timer && 'unref' in timer) {
          (timer as { unref: () => void }).unref()
        }
      })
    })
  })
}
