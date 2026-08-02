import { NextRequest, NextResponse } from 'next/server'
import { isAgentProvider } from '@/lib/provider'
import { listProtocolRuns, startProtocolRun } from '@/lib/agentCoordination'

export async function GET(request: NextRequest) {
  const limitParam = new URL(request.url).searchParams.get('limit')
  const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100)
  try {
    const runs = await listProtocolRuns(limit)
    return NextResponse.json({ runs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const baseCwd = typeof body.baseCwd === 'string' && body.baseCwd.trim() ? body.baseCwd.trim() : process.cwd()
  const provider = isAgentProvider(body.provider) ? body.provider : 'claude'
  const teammateProviders = Array.isArray(body.teammateProviders)
    ? [...new Set(body.teammateProviders.filter(isAgentProvider))]
    : undefined
  const maxAgents = Number.isFinite(Number(body.maxAgents))
    ? Math.min(Math.max(Number(body.maxAgents), 2), 6)
    : undefined
  const title = typeof body.title === 'string' ? body.title : undefined
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
  const effort = typeof body.effort === 'string' && body.effort.trim() ? body.effort.trim() : undefined
  const gateCommand = typeof body.gateCommand === 'string' && body.gateCommand.trim() ? body.gateCommand.trim() : undefined
  const requirePlanApproval = typeof body.requirePlanApproval === 'boolean' ? body.requirePlanApproval : undefined
  const useWorktrees = body.useWorktrees !== false
  const playbookName = typeof body.playbookName === 'string' && body.playbookName.trim() ? body.playbookName.trim() : undefined
  const playbookArgs = body.playbookArgs

  try {
    const result = await startProtocolRun({ prompt, baseCwd, provider, teammateProviders, maxAgents, title, model, effort, gateCommand, requirePlanApproval, useWorktrees, playbookName, playbookArgs })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
