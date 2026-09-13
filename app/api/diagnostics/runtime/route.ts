import { NextResponse } from 'next/server'
import { collectTelemetry, diagnosticsEnabled } from '@/lib/telemetry'

// Live runtime telemetry (memory, V8 heap stats + space breakdown, event-loop
// delay, GC pressure, cache/pool sizes, server perf rollup) for local debugging.
// Gated behind AGENT_VIEWER_DIAG=1 — returns 404 when disabled so the endpoint
// isn't discoverable in normal runs.
export async function GET() {
  if (!diagnosticsEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    return NextResponse.json(collectTelemetry())
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
