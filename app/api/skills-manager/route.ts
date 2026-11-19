import { NextResponse } from 'next/server'
import { nativeSkillsManager } from '@/lib/skills-manager/service'
import { applyPluginSettings, isPluginEnabled } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
export const runtime = 'nodejs'
const failure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
function check(cwd: unknown): asserts cwd is string {
  applyPluginSettings(readPluginSettingsFile())
  if (!isPluginEnabled('skills-manager')) throw new Error('Skills Manager is disabled')
  if (typeof cwd !== 'string' || !cwd || cwd.length > 4096) throw new Error('Repository cwd is required')
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, cwd = params.get('cwd'); check(cwd)
    const action = params.get('action') ?? 'scan'
    if (action !== 'scan' && action !== 'file') throw new Error('Unknown read operation')
    const result = action === 'scan' ? await nativeSkillsManager.scan(cwd, request.signal) : await nativeSkillsManager.file(cwd, params.get('skillId') ?? '', params.get('file') ?? '', request.signal)
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    const body = await request.json(); check(body.cwd)
    if (body.action !== 'preview' && body.action !== 'apply') throw new Error('Unknown Skills Manager operation')
    const result = body.action === 'preview' ? await nativeSkillsManager.preview(body.cwd, body.input, request.signal) : await nativeSkillsManager.apply(body.cwd, body.input, request.signal)
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
