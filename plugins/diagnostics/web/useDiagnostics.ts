import { useCallback, useEffect, useRef } from 'react'
import type { WebPluginViewProps } from '../../../components/shell/pluginTypes'
import type { SessionDiagnosticSection } from '../../../lib/types'
import { createPluginResourceScope } from '../../../lib/plugins/lifecycle'
import { claudeDiagnosticActionNotice } from '../domain/actions'

/** Holds the session it opened on. A read can activate a runtime. */
export function useDiagnostics({ services, useState }: WebPluginViewProps) {
  const diagnostics = services['session-diagnostics']!
  const [session, setSession] = useState('session', services.session?.session ?? null)
  const [loaded, setLoaded] = useState('loaded', false)
  const [diagnosticSections, setDiagnosticSections] = useState<SessionDiagnosticSection[]>('sections', [])
  const [error, setError] = useState<string | null>('error', null)
  const [notice, setNotice] = useState<string | null>('notice', null)
  const [claudeHookQuery, setClaudeHookQuery] = useState('hook-query', '')
  const [claudeMcpPermissionModes, setClaudeMcpPermissionModes] = useState<Record<string, 'default' | 'auto'>>('policies', {})
  // Loading and busy indicators reset for each mounted presentation lifetime.
  const [diagnosticsLoading, setDiagnosticsLoading] = useState('loading', false)
  const [claudeMcpBusy, setClaudeMcpBusy] = useState<string | null>('busy', null)
  const lifetime = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const actionBusy = useRef(false)

  const refresh = useCallback(async (signal: AbortSignal) => {
    if (!session || signal.aborted) return
    const request = ++sequence.current
    setDiagnosticsLoading(true)
    setError(null)
    try {
      const sections = await diagnostics.read(session, signal)
      if (signal.aborted || request !== sequence.current) return
      setDiagnosticSections(sections)
      setLoaded(true)
    } catch (error) {
      if (!signal.aborted && request === sequence.current) setError(error instanceof Error ? error.message : 'Could not read diagnostics')
    } finally {
      if (!signal.aborted && request === sequence.current) setDiagnosticsLoading(false)
    }
  }, [session, diagnostics, setDiagnosticsLoading, setDiagnosticSections, setLoaded, setError])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    actionBusy.current = false
    const scope = createPluginResourceScope('diagnostics')
    scope.defer(() => controller.abort())
    setSession(session)
    setClaudeMcpBusy(null)
    setDiagnosticsLoading(false)
    if (!loaded) void refresh(controller.signal)
    return () => scope.dispose()
    // A move retains loaded sections. It must not activate the runtime again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, diagnostics])

  const runClaudeSessionAction = useCallback(async (action: string, extra: Record<string, unknown>, busyKey: string, successNotice: string) => {
    const signal = lifetime.current?.signal
    if (!session || !signal || signal.aborted || actionBusy.current || !diagnostics.hasControls(session)) return null
    actionBusy.current = true
    ++sequence.current // Fence a read that started before this mutation.
    setDiagnosticsLoading(false)
    setClaudeMcpBusy(busyKey)
    setError(null)
    setNotice(null)
    try {
      const result = await diagnostics.run(session, action, extra, signal)
      if (signal.aborted) return null
      if (action === 'listHookEvents') {
        const events = Array.isArray(result.events) ? result.events as Record<string, unknown>[] : []
        const items = events.map(event => `${String(event.timestamp ?? '')} · ${String(event.summary ?? event.event ?? 'Hook')}`)
        setDiagnosticSections(current => current.map(section => section.id === 'hooks' ? { ...section, items: items.length ? items : ['None'] } : section))
        setNotice(`Hook timeline · ${events.length} match${events.length === 1 ? '' : 'es'}`)
      } else {
        setNotice(claudeDiagnosticActionNotice(action, successNotice, result))
        await refresh(signal)
      }
      return result
    } catch (error) {
      if (!signal.aborted) setError(error instanceof Error ? error.message : 'Action failed')
      return null
    } finally {
      if (!signal.aborted) { actionBusy.current = false; setClaudeMcpBusy(null) }
    }
  }, [session, diagnostics, refresh, setClaudeMcpBusy, setError, setNotice, setDiagnosticSections])

  const applyClaudeMcpPermissionMode = async (serverName: string, permissionModeKey: string, mode: 'default' | 'auto' | null, _previous: 'default' | 'auto' | undefined) => {
    const signal = lifetime.current?.signal
    const result = await runClaudeSessionAction('setMcpPermissionModeOverride', { serverName, mode }, `mcp:permission:${serverName}`, `MCP policy ${mode == null ? 'cleared' : `set to ${mode}`}.`)
    if (!result || !signal || signal.aborted) return
    setClaudeMcpPermissionModes(current => {
      const next = { ...current }
      if (mode == null) delete next[permissionModeKey]
      else next[permissionModeKey] = mode
      return next
    })
  }
  const addClaudeMcpServer = async () => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return
    const serverName = window.prompt('MCP server name')?.trim()
    if (!serverName) return
    const raw = window.prompt('MCP configuration JSON', '{"type":"http","url":"https://example.com/mcp"}')
    if (!raw || signal.aborted) return
    try { await runClaudeSessionAction('setMcpServers', { operation: 'add', serverName, config: JSON.parse(raw) }, `mcp:add:${serverName}`, `Added dynamic MCP server ${serverName}.`) }
    catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : 'Invalid MCP configuration JSON') }
  }
  const searchClaudeHookEvents = async () => { await runClaudeSessionAction('listHookEvents', { query: claudeHookQuery, limit: 100 }, 'hook-search', '') }
  return { session, diagnosticSections, diagnosticsLoading, claudeMcpBusy, claudeHookQuery, setClaudeHookQuery, claudeMcpPermissionModes, runClaudeSessionAction, applyClaudeMcpPermissionMode, addClaudeMcpServer, searchClaudeHookEvents, claudeHookSearching: claudeMcpBusy === 'hook-search', error, notice,
    refresh: () => { const signal = lifetime.current?.signal; if (signal) void refresh(signal) },
  }
}
