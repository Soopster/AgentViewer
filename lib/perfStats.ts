// Pure, isomorphic rolling-statistics core shared by the server perf logger
// (lib/perfLog.ts) and the client perf monitor (lib/clientPerf.ts). No env,
// console, or platform APIs — just accumulation and percentile snapshots so a
// single periodic log line summarizes "which operation is slow and how often"
// instead of emitting one line per call.

const RING_SIZE = 128

type LabelStat = {
  count: number
  totalMs: number
  maxMs: number
  // Bounded ring of recent samples for percentile estimates. Keeping only the
  // tail bounds memory regardless of call volume; percentiles reflect recent
  // behavior, which is what matters for a live "is it slow now" read.
  ring: number[]
  ringPos: number
}

export type PerfRow = {
  label: string
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  totalMs: number
}

export class PerfStats {
  private stats = new Map<string, LabelStat>()

  record(label: string, ms: number): void {
    let stat = this.stats.get(label)
    if (!stat) {
      stat = { count: 0, totalMs: 0, maxMs: 0, ring: [], ringPos: 0 }
      this.stats.set(label, stat)
    }
    stat.count += 1
    stat.totalMs += ms
    if (ms > stat.maxMs) stat.maxMs = ms
    if (stat.ring.length < RING_SIZE) stat.ring.push(ms)
    else {
      stat.ring[stat.ringPos] = ms
      stat.ringPos = (stat.ringPos + 1) % RING_SIZE
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[idx]
  }

  snapshot(): PerfRow[] {
    const rows: PerfRow[] = []
    for (const [label, stat] of this.stats) {
      const sorted = [...stat.ring].sort((a, b) => a - b)
      rows.push({
        label,
        count: stat.count,
        avgMs: stat.count > 0 ? stat.totalMs / stat.count : 0,
        p50Ms: this.percentile(sorted, 50),
        p95Ms: this.percentile(sorted, 95),
        maxMs: stat.maxMs,
        totalMs: stat.totalMs,
      })
    }
    // Sort by cumulative time — the biggest aggregate cost surfaces first.
    rows.sort((a, b) => b.totalMs - a.totalMs)
    return rows
  }

  reset(): void {
    this.stats.clear()
  }

  get size(): number {
    return this.stats.size
  }
}

export function formatPerfRow(row: PerfRow): string {
  const r = (n: number) => n.toFixed(n >= 100 ? 0 : 1)
  return `${row.label} n=${row.count} avg=${r(row.avgMs)}ms p50=${r(row.p50Ms)}ms p95=${r(row.p95Ms)}ms max=${r(row.maxMs)}ms`
}
