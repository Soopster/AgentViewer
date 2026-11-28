import { NextResponse, type NextRequest } from 'next/server'
import {
  changeLspDocument, closeLspDocument, lspApplyCodeAction, lspCodeActions, lspCompletion, lspDefinition, lspDocumentState, lspHover, lspRename, openLspDocument, savedLspDocument,
} from '@/plugins/editor/server/lspHost'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The Web editor's language server (plugins/editor/server/lspHost.ts). It
// spawns the project's configured servers, so it is `write`-scoped: a
// read-only paired device never starts a process here.
type Body = { action?: string; cwd?: string; path?: string; text?: string; position?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown }; trigger?: string; newName?: string; index?: number }

const position = (body: Body) => {
  const line = Number(body.position?.line), character = Number(body.position?.character)
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) throw new Error('A position is required')
  return { line, character }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as Body | null
  const cwd = body?.cwd ?? '', path = body?.path ?? ''
  try {
    switch (body?.action) {
      case 'open': return NextResponse.json(await openLspDocument(cwd, path, String(body.text ?? '')))
      case 'change': changeLspDocument(cwd, path, String(body.text ?? '')); return NextResponse.json({ ok: true })
      case 'saved': savedLspDocument(cwd, path, String(body.text ?? '')); return NextResponse.json({ ok: true })
      case 'state': return NextResponse.json(lspDocumentState(cwd, path))
      case 'close': closeLspDocument(cwd, path); return NextResponse.json({ ok: true })
      case 'completion': return NextResponse.json({ items: await lspCompletion(cwd, path, position(body), body.trigger) })
      case 'hover': return NextResponse.json({ hover: await lspHover(cwd, path, position(body)) })
      case 'definition': return NextResponse.json({ locations: await lspDefinition(cwd, path, position(body)) })
      case 'rename': return NextResponse.json({ edit: await lspRename(cwd, path, position(body), String(body.newName ?? '')) })
      case 'code-actions': return NextResponse.json({ actions: await lspCodeActions(cwd, path, { start: position(body), end: body.end ? position({ position: body.end }) : position(body) }) })
      case 'apply-code-action': return NextResponse.json({ edit: await lspApplyCodeAction(cwd, path, Number(body.index)) })
      default: return NextResponse.json({ error: 'unknown action' }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: message === 'That document is not open' ? 409 : 400 })
  }
}
