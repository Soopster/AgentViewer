import path from 'node:path'
import { NextResponse } from 'next/server'
import { pluginBehaviorHost } from '@/lib/plugins/serverBehaviors'

// The operations enabled plugins and mods offer to agents, and a way to call one. The agent-viewer MCP bridge lists them
// at start-up and on a timer, and forwards each call here; arguments are validated against the plugin's own declaration
// and a failure comes back as a result to read. Calling is write-scoped: a tool can change the app's own data.
export const runtime = 'nodejs'
export async function GET() {
  const tools = pluginBehaviorHost().listTools().map(({ pluginId, name, spec }) => ({ pluginId, name, description: spec.description, scope: spec.scope, fields: spec.fields }))
  return NextResponse.json({ tools }, { headers: { 'Cache-Control': 'no-store' } })
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { name?: unknown; args?: unknown; cwd?: unknown } | null
  if (!body || typeof body.name !== 'string' || body.name.length > 80) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  // The bridge's own working directory: the project the calling agent runs in. Advisory, like any argument.
  const cwd = typeof body.cwd === 'string' && body.cwd.length <= 4096 && path.isAbsolute(body.cwd) ? body.cwd : undefined
  const result = await pluginBehaviorHost().callTool(body.name, body.args, request.signal, { cwd })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
