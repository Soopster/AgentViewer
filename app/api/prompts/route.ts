import { NextRequest, NextResponse } from 'next/server'
import { listPrompts, savePrompt } from '@/lib/promptLibrary'
import { isAgentProvider } from '@/lib/provider'
import type { AgentProvider } from '@/lib/types'

export async function GET() {
  try {
    const prompts = await listPrompts()
    return NextResponse.json({ prompts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const title = typeof body?.title === 'string' ? body.title : ''
    const promptBody = typeof body?.body === 'string' ? body.body : ''
    if (!title.trim() || !promptBody.trim()) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 })
    }
    const tags = Array.isArray(body?.tags) ? body.tags.map((entry) => String(entry)) : undefined
    const providers = Array.isArray(body?.providers)
      ? body.providers.filter(isAgentProvider) as AgentProvider[]
      : undefined
    const record = await savePrompt({
      title,
      description: typeof body?.description === 'string' ? body.description : undefined,
      tags,
      providers,
      body: promptBody,
    })
    return NextResponse.json({ prompt: record })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
