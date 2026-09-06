import { NextRequest, NextResponse } from 'next/server'
import { deletePrompt, getPrompt, savePrompt } from '@/lib/promptLibrary'
import { isAgentProvider } from '@/lib/provider'
import type { AgentProvider } from '@/lib/types'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const record = await getPrompt(slug)
    if (!record) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    return NextResponse.json({ prompt: record })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const existing = await getPrompt(slug)
    if (!existing) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const title = typeof body?.title === 'string' ? body.title : existing.meta.title
    const promptBody = typeof body?.body === 'string' ? body.body : existing.body
    if (!title.trim() || !promptBody.trim()) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 })
    }
    const tags = Array.isArray(body?.tags) ? body.tags.map((entry) => String(entry)) : existing.meta.tags
    const providers = Array.isArray(body?.providers)
      ? body.providers.filter(isAgentProvider) as AgentProvider[]
      : existing.meta.providers
    const description = typeof body?.description === 'string' ? body.description : existing.meta.description

    const record = await savePrompt({ slug, title, description, tags, providers, body: promptBody })
    return NextResponse.json({ prompt: record })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const removed = await deletePrompt(slug)
    if (!removed) return NextResponse.json({ error: 'Prompt not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
