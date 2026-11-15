import { NextResponse } from 'next/server'
import { nativeAdaptiveUi } from '@/lib/adaptiveUi/runtime'
import { applyPluginSettings, isPluginEnabled } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
export const runtime = 'nodejs'
const failure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
const STATUSES = new Set(['draft', 'active', 'disabled'])
function check(): void {
  applyPluginSettings(readPluginSettingsFile())
  if (!isPluginEnabled('adaptive-ui')) throw new Error('Adaptive UI is disabled')
}
const text = (value: unknown, max: number): string => { if (typeof value !== 'string' || !value || value.length > max) throw new Error('invalid argument'); return value }
export async function GET() {
  try { check(); return NextResponse.json({ result: await nativeAdaptiveUi.scan() }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    check()
    const body = await request.json()
    let result: unknown = null
    if (body.action === 'set-status') { if (!STATUSES.has(body.status)) throw new Error('invalid status'); await nativeAdaptiveUi.setStatus(text(body.id, 64), body.status) }
    else if (body.action === 'remove') await nativeAdaptiveUi.remove(text(body.id, 64))
    else if (body.action === 'dismiss') await nativeAdaptiveUi.dismissShape(text(body.key, 400), body.dismissed !== false)
    else if (body.action === 'design-prompt') result = await nativeAdaptiveUi.designPrompt(text(body.key, 400))
    else throw new Error('Unknown Adaptive UI operation')
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
