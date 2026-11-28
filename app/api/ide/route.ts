import { NextResponse } from 'next/server'
import { nativeIde } from '@/lib/ide/service'
import { isIdeId } from '@/lib/ideCatalog'
import { evaluateRequestTrust, isLocalOrigin } from '@/lib/remoteAuth'
export const runtime = 'nodejs'

const fail = (error: unknown, status = 400) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status })
const int = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

export async function GET() {
  try { return NextResponse.json({ result: await nativeIde.read() }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return fail(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (body?.action === 'set') {
      if (!isIdeId(body.ide)) throw new Error('Unknown editor')
      return NextResponse.json({ result: await nativeIde.setPreference(body.ide) })
    }
    if (body?.action === 'open') {
      // An editor opens on THIS machine's screen: only a page served to this machine may ask.
      // A browser always sends Origin on a POST, so a missing one is not a local page either.
      const origin = request.headers.get('origin')
      const trust = await evaluateRequestTrust(request)
      if (!origin || !isLocalOrigin(origin) || trust.source !== 'local') return fail(new Error('Opening an editor is only allowed from this machine'), 403)
      if (typeof body.path !== 'string') throw new Error('No file to open')
      const ide = body.ide === undefined ? undefined : isIdeId(body.ide) && body.ide !== 'builtin' ? body.ide : null
      if (ide === null) throw new Error('Unknown editor')
      return NextResponse.json({ result: await nativeIde.open({ path: body.path, line: int(body.line), column: int(body.column), cwd: typeof body.cwd === 'string' ? body.cwd : null, ...(ide ? { ide } : {}) }) })
    }
    throw new Error('Unknown IDE operation')
  } catch (error) { return fail(error) }
}
