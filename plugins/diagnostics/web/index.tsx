'use client'
import { useEffect, useRef } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '../../../components/shell/pluginTypes'
import { CLAUDE_DIAGNOSTIC_ACTIONS } from '../domain/actions'
import { useDiagnostics } from './useDiagnostics'

function DiagnosticsView(props: WebPluginViewProps) {
  const { placement, close } = props
  const { session, diagnosticSections, diagnosticsLoading, claudeMcpBusy, claudeHookQuery, setClaudeHookQuery, claudeMcpPermissionModes, runClaudeSessionAction, applyClaudeMcpPermissionMode, addClaudeMcpServer, searchClaudeHookEvents, claudeHookSearching, error, notice, refresh } = useDiagnostics(props)
  const controls = session ? props.services['session-diagnostics']!.hasControls(session) : false
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const view = <section role={placement === 'overlay' ? 'dialog' : 'region'} aria-label="Session diagnostics" aria-modal={placement === 'overlay' ? true : undefined}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}
    style={{ width: placement === 'overlay' ? 'min(1000px, 94vw)' : '100%', maxHeight: placement === 'overlay' ? '80vh' : '100%', overflow: 'auto', background: 'var(--surface)', borderRadius: 8, padding: 12 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text-2)' }}>{session?.summary ?? session?.sessionId}</span>
      <button type="button" disabled={!!claudeMcpBusy || diagnosticsLoading} onClick={refresh}>Refresh</button>
      <button ref={closeRef} type="button" onClick={close}>Close</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
          <div
            style={{
              marginBottom: 18,
              padding: '14px 16px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
              <div style={{ fontFamily: "'Oxanium', monospace", fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                Session Diagnostics
              </div>
              {session && controls && (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 5 }}>
                  {CLAUDE_DIAGNOSTIC_ACTIONS.map(([action, busyKey, label, notice, title]) => (
                    <button
                      key={action}
                      type="button"
                      className="av-hover-control"
                      onClick={() => { void runClaudeSessionAction(action, {}, busyKey, notice) }}
                      disabled={claudeMcpBusy !== null}
                      title={title}
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: 'var(--cyan)',
                        background: 'var(--surface)',
                        border: '1px solid rgba(56,217,245,0.3)',
                        borderRadius: 5,
                        padding: '3px 8px',
                        cursor: claudeMcpBusy !== null ? 'not-allowed' : 'pointer',
                        letterSpacing: '0.06em',
                        opacity: claudeMcpBusy !== null && claudeMcpBusy !== busyKey ? 0.45 : 1,
                      }}
                    >
                      {claudeMcpBusy === busyKey ? 'WORKING…' : label}
                    </button>
                  ))}
                </div>
              )}
              </div>
            {diagnosticsLoading ? (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
                Loading diagnostics…
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                {diagnosticSections.map((section) => (
                  <div key={section.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>
                        {section.title}
                      </span>
                      {section.id === 'mcp' && session && controls && (
                        <button
                          type="button"
                          className="av-hover-control"
                          onClick={() => { void addClaudeMcpServer() }}
                          disabled={claudeMcpBusy !== null}
                          title="Add a session-scoped MCP server"
                          style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--green)', background: 'transparent', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 4, height: 18, padding: '0 5px', cursor: claudeMcpBusy ? 'not-allowed' : 'pointer' }}
                        >
                          + ADD
                        </button>
                      )}
                      {section.id === 'hooks' && session && controls && (
                        <span style={{ display: 'flex', gap: 4, minWidth: 0 }}>
                          <input
                            aria-label="Search Claude hook timeline"
                            value={claudeHookQuery}
                            onChange={(event) => setClaudeHookQuery(event.target.value)}
                            onKeyDown={(event) => { if (event.key === 'Enter') void searchClaudeHookEvents() }}
                            placeholder="filter hooks"
                            style={{ width: 110, height: 18, padding: '0 5px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }}
                          />
                          <button
                            type="button"
                            className="av-hover-control"
                            onClick={() => { void searchClaudeHookEvents() }}
                            disabled={claudeHookSearching}
                            style={{ height: 18, padding: '0 5px', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--cyan)', background: 'transparent', border: '1px solid rgba(56,217,245,0.3)', borderRadius: 4, cursor: claudeHookSearching ? 'wait' : 'pointer' }}
                          >
                            {claudeHookSearching ? '…' : 'SEARCH'}
                          </button>
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {section.id === 'mcp' && session && controls ? (
                        section.items.map((item, index) => {
                          if (item === 'None') {
                            return <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>None</div>
                          }
                          const [rawName, rawStatus] = item.split(' · ')
                          const name = rawName?.trim() ?? ''
                          const status = rawStatus?.trim() ?? ''
                          const dynamic = item.endsWith(' · dynamic')
                          const enabled = status !== 'disabled'
                          const permissionModeKey = `${session.sessionId}:${name}`
                          const appliedPermissionMode = claudeMcpPermissionModes[permissionModeKey]
                          const busyKey = `mcp:${name}`
                          const busy = claudeMcpBusy !== null
                          return (
                            <div
                              key={`${section.id}-${index}`}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 6,
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 11,
                                color: 'var(--text-2)',
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }} title={item}>
                                {name} <span style={{ color: enabled ? 'var(--green)' : 'var(--text-3)' }}>· {status}</span>
                              </span>
                              <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                <select
                                  aria-label={`Permission policy for MCP server ${name}`}
                                  title={`Claude permission policy for ${name}`}
                                  value={appliedPermissionMode ?? ''}
                                  disabled={busy}
                                  onChange={(event) => {
                                    const selected = event.target.value
                                    const mode = selected === 'clear' ? null : selected === 'auto' ? 'auto' : 'default'
                                    const previous = appliedPermissionMode
                                    void applyClaudeMcpPermissionMode(name, permissionModeKey, mode, previous)
                                  }}
                                  style={{
                                    height: 18,
                                    maxWidth: 82,
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 11,
                                    color: 'var(--text-2)',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 4,
                                  }}
                                >
                                  <option value="" disabled>POLICY…</option>
                                  <option value="default">DEFAULT</option>
                                  <option value="auto">Auto</option>
                                  <option value="clear">CLEAR</option>
                                </select>
                                <button
                                  type="button"
                                  className="av-hover-control"
                                  onClick={() => runClaudeSessionAction('reconnectMcpServer', { serverName: name }, busyKey, `Reconnected ${name}.`)}
                                  disabled={busy}
                                  title={`Reconnect ${name}`}
                                  style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 11,
                                    color: 'var(--cyan)',
                                    background: 'transparent',
                                    border: '1px solid rgba(56,217,245,0.3)',
                                    borderRadius: 4,
                                    padding: '0 5px',
                                    height: 18,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    letterSpacing: '0.06em',
                                    opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  RECONN
                                </button>
                                <button
                                  type="button"
                                  className="av-hover-control"
                                  onClick={() => runClaudeSessionAction('toggleMcpServer', { serverName: name, enabled: !enabled }, `mcp:toggle:${name}`, `${enabled ? 'Disabled' : 'Enabled'} ${name}.`)}
                                  disabled={busy}
                                  title={`${enabled ? 'Disable' : 'Enable'} ${name}`}
                                  style={{
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontSize: 11,
                                    color: enabled ? 'var(--yellow)' : 'var(--green)',
                                    background: 'transparent',
                                    border: enabled ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(74,222,128,0.3)',
                                    borderRadius: 4,
                                    padding: '0 5px',
                                    height: 18,
                                    cursor: busy ? 'not-allowed' : 'pointer',
                                    letterSpacing: '0.06em',
                                    opacity: busy ? 0.5 : 1,
                                  }}
                                >
                                  {enabled ? 'DISABLE' : 'ENABLE'}
                                </button>
                                {dynamic && (
                                  <button
                                    type="button"
                                    className="av-hover-control"
                                    onClick={() => runClaudeSessionAction('setMcpServers', { operation: 'remove', serverName: name }, `mcp:remove:${name}`, `Removed dynamic MCP server ${name}.`)}
                                    disabled={busy}
                                    title={`Remove dynamic MCP server ${name}`}
                                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--red)', background: 'transparent', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, padding: '0 5px', height: 18, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}
                                  >
                                    REMOVE
                                  </button>
                                )}
                              </span>
                            </div>
                          )
                        })
                      ) : (
                        section.items.map((item, index) => (
                          <div key={`${section.id}-${index}`} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-2)' }}>
                            {item}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
  </section>
  return placement === 'overlay' ? <div onMouseDown={event => { if (event.target === event.currentTarget) close() }} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>{view}</div> : view
}
export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'diagnostics', views: { diagnostics: DiagnosticsView },
}
