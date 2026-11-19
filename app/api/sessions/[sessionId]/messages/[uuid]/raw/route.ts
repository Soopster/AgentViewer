import { NextRequest, NextResponse } from 'next/server'
import { evaluateRequestTrust } from '@/lib/remoteAuth'
import { readRawFrame } from '@/lib/rawFrames'

/** The provider frame a message was normalized from — see lib/rawFrames.ts.
 *
 *  Full scope only. A raw frame is whatever the provider sent: file contents,
 *  complete tool output, anything a normalizing pass would otherwise have
 *  dropped. A read-only paired device can watch a session; it has no business
 *  reading the unredacted bytes behind it. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; uuid: string }> },
) {
  const verdict = await evaluateRequestTrust(request)
  if (!verdict.trusted || verdict.scope !== 'full') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { sessionId, uuid } = await params
  const frame = readRawFrame(sessionId, uuid)
  // Eviction is the normal end state for anything but a recent message, so
  // this is a 404, not an error condition.
  if (!frame) {
    return NextResponse.json(
      { error: 'No raw frame retained for this message' },
      { status: 404 },
    )
  }
  return NextResponse.json({ uuid, ...frame })
}
