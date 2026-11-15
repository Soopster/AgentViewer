import { NextResponse } from 'next/server'
import { nativeInstructionsManager } from '@/lib/instructions-manager/service'
import { applyPluginSettings, isPluginEnabled } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
export const runtime = 'nodejs'
function check(cwd: unknown): asserts cwd is string {
  applyPluginSettings(readPluginSettingsFile())
  if (!isPluginEnabled('instructions-manager')) throw new Error('Instructions Manager is disabled')
  if (typeof cwd !== 'string' || !cwd || cwd.length > 4096) throw new Error('Repository cwd is required')
}
const failure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
export async function GET(request: Request) {
  try { const params = new URL(request.url).searchParams, cwd = params.get('cwd'), path = params.get('path'); check(cwd); return NextResponse.json({ result: path ? await nativeInstructionsManager.read(cwd, path, request.signal) : await nativeInstructionsManager.scan(cwd, request.signal) }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get('content-length')) > 2_000_000) throw new Error('Instruction request is too large')
    const body = await request.json(); check(body.cwd)
    let result
    if (body.action === 'read' && typeof body.path === 'string') result = await nativeInstructionsManager.read(body.cwd, body.path, request.signal)
    else if (body.action === 'preview') result = await nativeInstructionsManager.preview(body.cwd, body.change, request.signal)
    else if (body.action === 'apply' && typeof body.replace === 'boolean') result = await nativeInstructionsManager.apply(body.cwd, body.requestId, body.previewHash, body.change, body.replace, request.signal)
    else throw new Error('Unknown Instructions Manager action')
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
