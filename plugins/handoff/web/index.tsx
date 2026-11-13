'use client'

// Web entry for the Handoff brief plugin: its own chunk, loaded on first open.
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { GitData } from '@/lib/gitProvider'
import { buildHandoffBriefMarkdown } from '@/lib/handoffBrief'

function HandoffView({ services, placement, close }: WebPluginViewProps) {
  const session = services.session?.session ?? null
  const transcript = services['session-transcript'] ?? null
  const handoff = services.handoff!
  const [git, setGit] = useState<GitData | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [bookmarkIds, setBookmarkIds] = useState<ReadonlySet<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const cwd = transcript?.info?.cwd ?? session?.cwd ?? null

  useEffect(() => {
    if (!cwd) { setGit(null); setGitError(null); return undefined }
    const controller = new AbortController()
    handoff.readGit(cwd, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setGit(data); setGitError(null) } })
      .catch((err: unknown) => { if (!controller.signal.aborted) { setGit(null); setGitError(err instanceof Error ? err.message : 'git unavailable') } })
    return () => controller.abort()
  }, [handoff, cwd])
  useEffect(() => {
    if (!session || session.isPending) return undefined
    const controller = new AbortController()
    handoff.bookmarkIds(session, controller.signal)
      .then(ids => { if (!controller.signal.aborted) setBookmarkIds(new Set(ids)) })
      .catch(() => { /* a brief without bookmarks is still a brief */ })
    return () => controller.abort()
  }, [handoff, session?.provider, session?.sessionId, session?.isPending])

  const markdown = useMemo(() => buildHandoffBriefMarkdown({ session, detail: transcript, git, gitError, bookmarkIds }), [session, transcript, git, gitError, bookmarkIds])
  const docked = placement !== 'overlay'
  useEffect(() => {
    if (docked) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, close])

  const copy = () => { void navigator.clipboard?.writeText(markdown).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800) }) }
  const body = (
    <div data-plugin-view="handoff" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)', color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 600, flex: 1 }}>Handoff brief</span>
        {gitError ? <span style={{ fontSize: 12, color: 'var(--text-2)' }}>git unavailable</span> : null}
        <button type="button" onClick={copy} style={{ fontSize: 12 }}>{copied ? 'Copied' : 'Copy markdown'}</button>
        {!docked ? <button type="button" aria-label="Close" onClick={close} style={{ fontSize: 12 }}>✕</button> : null}
      </div>
      <div className="prose-sm" style={{ flex: 1, overflow: 'auto', padding: '10px 18px', fontSize: 13, lineHeight: 1.55 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
    </div>
  )
  if (docked) return body
  return (
    <div role="dialog" aria-label="Handoff brief" onClick={close}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div onClick={event => event.stopPropagation()}
        style={{ width: 'min(820px, calc(100vw - 32px))', height: 'min(720px, calc(100vh - 48px))', border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))' }}>
        {body}
      </div>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'handoff',
  views: { handoff: HandoffView },
}
