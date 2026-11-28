import { NextResponse } from 'next/server'
import { nativeProjectMemory } from '@/lib/project-memory/service'
import { applyPluginSettings, isPluginEnabled } from '@/lib/plugins/enablement'
import { readPluginSettingsFile } from '@/lib/plugins/settingsFile'
export const runtime = 'nodejs'
function check(cwd: unknown): asserts cwd is string { applyPluginSettings(readPluginSettingsFile()); if (!isPluginEnabled('project-memory')) throw new Error('Project Memory is disabled'); if (typeof cwd !== 'string' || !cwd || cwd.length > 4096) throw new Error('Repository cwd is required') }
const failure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
export async function GET(request: Request) { try { const cwd = new URL(request.url).searchParams.get('cwd'); check(cwd); return NextResponse.json({ result: await nativeProjectMemory.read(cwd, request.signal) }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return failure(error) } }
export async function POST(request: Request) { try { const body = await request.json(); check(body.cwd); return NextResponse.json({ result: await nativeProjectMemory.mutate(body.cwd, body.requestId, body.operation, request.signal) }) } catch (error) { return failure(error) } }
