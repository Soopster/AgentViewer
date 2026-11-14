import { NextResponse } from 'next/server'
import { nativeProof } from '@/lib/proof/service'
import { isAgentProvider } from '@/lib/provider'
import type { ProofCheck, ProofRun } from '@/lib/plugins/proof'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams, cwd = params.get('cwd')
  if (!cwd) return NextResponse.json({ error: 'cwd is required' }, { status: 400 })
  try {
    const action = params.get('action') ?? 'read'
    if (action !== 'read' && action !== 'output') throw new Error('Unknown read operation')
    const result = action === 'read' ? await nativeProof.read(cwd, request.signal) : await nativeProof.output(cwd, params.get('id') ?? '', params.get('checkId') ?? '', request.signal)
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}
export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body || typeof body.cwd !== 'string') throw new Error('cwd is required')
    let result: unknown
    if (body.action === 'configure') {
      if (typeof body.version !== 'string') throw new Error('Configuration version is required')
      result = await nativeProof.configure(body.cwd, body.checks as ProofCheck[], body.version)
    } else if (body.action === 'start') {
      if (typeof body.version !== 'string') throw new Error('Configuration version is required')
      let origin: ProofRun['origin']
      if (body.origin) {
        if (!isAgentProvider(body.origin.provider) || typeof body.origin.sessionId !== 'string' || (body.origin.providerInstanceId !== undefined && typeof body.origin.providerInstanceId !== 'string')) throw new Error('Invalid session identity')
        origin = { provider: body.origin.provider, sessionId: body.origin.sessionId, ...(body.origin.providerInstanceId ? { providerInstanceId: body.origin.providerInstanceId } : {}) }
      }
      result = await nativeProof.start(body.cwd, body.ids, body.version, origin)
    } else if (body.action === 'cancel' && typeof body.id === 'string') result = await nativeProof.cancel(body.cwd, body.id)
    else throw new Error('Unknown Proof operation')
    return NextResponse.json({ result: result ?? null })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
}
