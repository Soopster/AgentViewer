import { NextResponse } from 'next/server'
import { diagnosticsEnabled, heapSnapshotStream } from '@/lib/telemetry'

// Stream a V8 heap snapshot as a downloadable .heapsnapshot file. Load it in
// Chrome DevTools → Memory → "Load" to inspect retained objects / detached DOM
// equivalents on the server heap. Gated behind AGENT_VIEWER_DIAG=1.
//
// Note: taking a snapshot briefly pauses the process and the file can be large.
export async function GET() {
  if (!diagnosticsEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return new Response(heapSnapshotStream(), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="agent-viewer-${stamp}.heapsnapshot"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
