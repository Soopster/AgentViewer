'use client'

import { useEffect, useRef, useState } from 'react'
import type { McpResourceLink, Session, ToolResultBlock } from '@/lib/types'
import { mcpArtifactHref, mcpResourceLinks } from '@/lib/mcpArtifacts'

export function McpArtifactLinks({ links }: { links: McpResourceLink[] }) {
  if (!links.length) return null
  return <div style={{ padding: '8px 12px', display: 'grid', gap: 6, overflowWrap: 'anywhere' }}>
    {links.map(link => {
      const href = mcpArtifactHref(link.uri)
      const title = link.title || link.name
      return <div key={link.uri}>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)' }}>{title}</a>
          : <span>{title}: <code>{link.uri}</code></span>}
        {link.mimeType && <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>{link.mimeType}</span>}
        {link.description && <div style={{ color: 'var(--text-2)', fontSize: 12 }}>{link.description}</div>}
      </div>
    })}
  </div>
}

function McpAppFrame({ html, input, result }: { html: string; input: Record<string, unknown>; result: ToolResultBlock }) {
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target || event.data?.jsonrpc !== '2.0') return
      const message = event.data
      const post = (value: unknown) => target.postMessage(value, '*') // sandbox has an opaque origin
      if (message.method === 'ui/initialize' && (typeof message.id === 'string' || typeof message.id === 'number')) {
        post({ jsonrpc: '2.0', id: message.id, result: {
          protocolVersion: '2026-01-26', hostInfo: { name: 'Agent Viewer', version: '0.1.0' },
          hostCapabilities: {}, hostContext: { displayMode: 'inline' },
        } })
      } else if (message.method === 'ui/notifications/initialized') {
        post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: input } })
        post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {
          content: typeof result.content === 'string' ? [{ type: 'text', text: result.content }] : result.content,
          ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
          ...(result.mcpMeta ? { _meta: result.mcpMeta } : {}),
          isError: result.is_error === true,
        } })
      } else if (message.id !== undefined && typeof message.method === 'string') {
        post({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'This preview does not support host actions.' } })
      }
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [input, result])
  // Wait until the listener is mounted before loading an app that may initialize immediately.
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  return ready ? <iframe ref={frame} title="MCP App preview" sandbox="allow-scripts" referrerPolicy="no-referrer"
    srcDoc={html} style={{ width: '100%', height: 360, border: '1px solid var(--border)', background: 'white' }} /> : null
}

export function McpToolArtifacts({ result, input, session, serverName, toolName }: {
  result: ToolResultBlock
  input: Record<string, unknown>
  session?: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>
  serverName: string
  toolName: string
}) {
  const [preview, setPreview] = useState<{ html?: string; error?: string; loading?: boolean }>({})
  const [open, setOpen] = useState(false)
  const links = mcpResourceLinks(result.resourceLinks, Array.isArray(result.content) ? result.content : [])
  async function loadPreview() {
    if (preview.html) { setOpen(value => !value); return }
    if (!session || preview.loading) return
    setPreview({ loading: true })
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.sessionId)}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getMcpApp', provider: 'claude', providerInstanceId: session.providerInstanceId, serverName, toolName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load MCP App.')
      if (!data.result?.available || typeof data.result.html !== 'string') throw new Error('This tool does not provide an MCP App preview.')
      setPreview({ html: data.result.html })
      setOpen(true)
    } catch (error) { setPreview({ error: error instanceof Error ? error.message : 'Unable to load MCP App.' }) }
  }
  return <>
    <McpArtifactLinks links={links} />
    {session?.provider === 'claude' && <div style={{ padding: '6px 12px', display: 'grid', gap: 8 }}>
      <button type="button" onClick={loadPreview} disabled={preview.loading} aria-expanded={open}
        style={{ justifySelf: 'start', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px',
          background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' }}>
        {preview.loading ? 'Loading MCP App…' : open ? 'Hide MCP App preview' : 'Open MCP App preview'}
      </button>
      {preview.error && <span role="status">{preview.error}</span>}
      {open && preview.html && <McpAppFrame html={preview.html} input={input} result={result} />}
    </div>}
  </>
}
