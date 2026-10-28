import { isAgentProvider } from '@/lib/provider'
import { NextRequest, NextResponse } from 'next/server'
import {
  previewInteractiveWorkflow,
  deleteRunPlaybook,
  listRunPlaybooks,
  loadRunPlaybook,
  writeRunPlaybook,
} from '@/lib/agentCoordination'

function cwdFrom(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : process.cwd()
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Playbook operation failed'
  const status = /not found/i.test(message) ? 404 : /already exists/i.test(message) ? 409 : 400
  return NextResponse.json({ error: message }, { status })
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const cwd = cwdFrom(params.get('cwd'))
  const name = params.get('name')?.trim()
  try {
    if (params.get('preview') === 'interactive') {
      const provider = params.get('provider')
      if (!name || !isAgentProvider(provider)) throw new Error('Workflow name and provider are required')
      return NextResponse.json(await previewInteractiveWorkflow({ cwd, name, provider, args: params.has('args') ? JSON.parse(params.get('args')!) : undefined }), { headers: { 'Cache-Control': 'no-store' } })
    }
    const result = name
      ? { playbook: await loadRunPlaybook(cwd, name) }
      : await listRunPlaybooks(cwd)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || body.playbook === undefined) {
    return NextResponse.json({ error: 'playbook is required' }, { status: 400 })
  }
  try {
    const result = await writeRunPlaybook(
      cwdFrom(body.cwd),
      body.playbook,
      typeof body.previousName === 'string' ? body.previousName : undefined,
    )
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'playbook name is required' }, { status: 400 })
  }
  try {
    return NextResponse.json(await deleteRunPlaybook(cwdFrom(body.cwd), body.name))
  } catch (error) {
    return errorResponse(error)
  }
}
