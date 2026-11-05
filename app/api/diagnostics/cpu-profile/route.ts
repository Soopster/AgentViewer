import { NextResponse } from 'next/server'
import { captureCpuProfile, diagnosticsEnabled } from '@/lib/telemetry'

export const maxDuration = 120

// Capture a CPU profile over ?ms=<duration> (default 5000, max 60000) and return
// it as a downloadable .cpuprofile (Chrome DevTools → Performance → "Load
// profile"). Drive load against the server while this runs to see where CPU
// goes. Gated behind AGENT_VIEWER_DIAG=1.
export async function GET(request: Request) {
  if (!diagnosticsEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { searchParams } = new URL(request.url)
  const ms = Math.min(60_000, Math.max(500, Number.parseInt(searchParams.get('ms') ?? '', 10) || 5000))
  try {
    const profile = await captureCpuProfile(ms)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return new Response(profile, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="agent-viewer-${stamp}.cpuprofile"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
