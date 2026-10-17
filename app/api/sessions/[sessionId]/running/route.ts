import { NextResponse } from 'next/server'
import { readViewSessionRunning } from '@/lib/sessionBackend'

// Lightweight, process-local check for whether a turn is still running
// server-side for this session. Clients poll this to reattach to a live turn
// after navigating away or reloading (turns keep running with
// detachOnClientAbort), and to know when a reattached turn has finished.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params
  const info = readViewSessionRunning(sessionId)
  return NextResponse.json(info, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
