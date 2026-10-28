/** @jsxImportSource @opentui/react */
// The diagnostics panel (⇧D): a modal near the top, or docked in a window.
//
// It reads once per open, for the session it was opened on, and holds that
// session while the selection moves: a diagnostics read can activate a session
// (Copilot), so following the selection would do that on every keystroke.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { Session, SessionDiagnosticSection } from '../../../lib/types'
import { fitText, isCtrlKey, isShiftedKey, popoverRootProps, type TuiPluginKeyEvent, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { DiagnosticsTable, diagnosticRuns } from './DiagnosticsTable'

type McpPolicy = 'default' | 'auto'

export function DiagnosticsView({ services, theme, width, height, placement, target, zIndex, useState, registerKeys, close }: TuiPluginViewProps) {
  const diagnostics = services['session-diagnostics']!
  const offered = services.session?.session ?? null
  const [session, setSession] = useState<Session | null>('session', null)
  const [loadedRequest, setLoadedRequest] = useState<number | null>('request', null)
  const [loading, setLoading] = useState('loading', false)
  const [sections, setSections] = useState<SessionDiagnosticSection[]>('sections', [])
  const [error, setError] = useState<string | null>('error', null)
  const [notice, setNotice] = useState<string | null>('notice', null)
  const [busy, setBusy] = useState<string | null>('busy', null)
  const [mcpIndex, setMcpIndex] = useState('mcpIndex', 0)
  const [mcpPolicies, setMcpPolicies] = useState<Record<string, McpPolicy>>('mcpPolicies', {})
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)

  const refresh = useCallback(async (target: Session) => {
    setLoading(true)
    setError(null)
    try {
      setSections(await diagnostics.read(target))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics')
    } finally {
      setLoading(false)
    }
  }, [diagnostics, setError, setLoading, setSections])

  // A new open (the host's request count moved) reads the session it names.
  const request = target.request ?? 0
  useEffect(() => {
    if (session && loadedRequest === request) return
    if (!offered) return
    setSession(offered)
    setLoadedRequest(request)
    setMcpIndex(0)
    void refresh(offered)
  // Only a new request or a first session starts a read; see the header.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, offered === null])

  const controls = session ? diagnostics.hasControls(session) : false
  const mcpRows = useMemo(() => sections.find((s) => s.id === 'mcp')?.items.filter((i) => i !== 'None') ?? [], [sections])

  const runAction = useCallback(async (action: string, extra: Record<string, unknown>, busyKey: string) => {
    if (!session || !diagnostics.hasControls(session)) return null
    setBusy(busyKey)
    setError(null)
    setNotice(null)
    try {
      const result = await diagnostics.run(session, action, extra)
      if (action === 'resolveSettings') {
        const sources = typeof result.sourceCount === 'number'
          ? result.sourceCount
          : Array.isArray(result.sources) ? result.sources.length : null
        const effective = typeof result.effectiveKeyCount === 'number'
          ? result.effectiveKeyCount
          : Array.isArray(result.effectiveKeys) ? result.effectiveKeys.length : null
        setNotice(`Settings resolved${sources == null ? '' : ` · ${sources} source${sources === 1 ? '' : 's'}`}${effective == null ? '' : ` · ${effective} effective key${effective === 1 ? '' : 's'}`}`)
      } else if (action === 'reloadSkills') {
        setNotice('Skills reloaded')
      } else if (action === 'reloadPlugins') {
        setNotice('Plugins reloaded')
      } else if (action === 'setMcpPermissionModeOverride') {
        const mode = extra.mode == null ? 'cleared' : `set to ${String(extra.mode)}`
        setNotice(`MCP policy ${mode}`)
      } else if (action === 'setMcpServers') {
        const dynamicServers = Array.isArray(result.dynamicServers) ? result.dynamicServers.length : 0
        const authRequired = Array.isArray(result.authRequired)
          ? result.authRequired.filter((name): name is string => typeof name === 'string')
          : []
        const errors = result.errors && typeof result.errors === 'object' && !Array.isArray(result.errors)
          ? Object.keys(result.errors)
          : []
        setNotice(
          authRequired.length > 0
            ? `Dynamic MCP updated · authentication required: ${authRequired.join(', ')}`
            : errors.length > 0
              ? `Dynamic MCP updated · connection failed: ${errors.join(', ')}`
              : `Dynamic MCP updated · ${dynamicServers} server${dynamicServers === 1 ? '' : 's'}`,
        )
      } else if (action === 'listHookEvents') {
        const events = Array.isArray(result.events) ? result.events as Array<Record<string, unknown>> : []
        const items = events.map((event) => `${String(event.timestamp ?? '')} · ${String(event.summary ?? event.event ?? 'Hook')}`)
        setSections((current) => current.map((section) => section.id === 'hooks'
          ? { ...section, items: items.length > 0 ? items : ['None'] }
          : section))
        setNotice(`Hook timeline · ${events.length} match${events.length === 1 ? '' : 'es'}`)
      }
      if (action !== 'listHookEvents') await refresh(session)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
      return null
    } finally {
      setBusy(null)
    }
  }, [diagnostics, refresh, session, setBusy, setError, setNotice, setSections])

  const readDraft = services.composer?.readDraft
  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    const shortcut = { ...key, meta: key.meta ?? false, option: key.option ?? false }
    if (key.name === 'escape' || isShiftedKey(shortcut, 'D') || isCtrlKey(shortcut, 'c')) {
      close()
      return
    }
    // Scrolling is bound before the controls below: the sections that overflow
    // (context window, permission rules) exist for one runtime, but every
    // provider's diagnostics can outgrow the panel, and a panel that silently
    // clips is worse than one that scrolls.
    const scroll = scrollRef.current
    if (scroll) {
      const page = Math.max(Math.floor(scroll.height / 2), 1)
      if (isCtrlKey(shortcut, 'd') || key.name === 'pagedown') {
        scroll.scrollTo(scroll.scrollTop + page)
        return
      }
      if (isCtrlKey(shortcut, 'u') || key.name === 'pageup') {
        scroll.scrollTo(Math.max(scroll.scrollTop - page, 0))
        return
      }
    }
    if (!session || !controls) return
    if (mcpRows.length === 0 && key.name !== 'p' && key.name !== 's' && key.name !== 'g') return
    if (key.name === 'up' || key.name === 'k') {
      setMcpIndex((i) => Math.max(0, i - 1))
      return
    }
    if (key.name === 'down' || key.name === 'j') {
      setMcpIndex((i) => Math.min(mcpRows.length - 1, i + 1))
      return
    }
    const row = mcpRows[mcpIndex]
    if (key.name === 'r' && row) {
      const name = row.split(' · ')[0]?.trim() ?? ''
      if (name) void runAction('reconnectMcpServer', { serverName: name }, `mcp:${name}`)
      return
    }
    if (key.name === 't' && row) {
      const [rawName, rawStatus] = row.split(' · ')
      const name = rawName?.trim() ?? ''
      const status = rawStatus?.trim() ?? ''
      if (name) void runAction('toggleMcpServer', { serverName: name, enabled: status === 'disabled' }, `mcp:toggle:${name}`)
      return
    }
    if (key.name === 'o' && row) {
      const name = row.split(' · ')[0]?.trim() ?? ''
      if (name) {
        const policyKey = `${session.sessionId}:${name}`
        const previous: McpPolicy | undefined = mcpPolicies[policyKey]
        const mode: McpPolicy | null = previous == null ? 'default' : previous === 'default' ? 'auto' : null
        setMcpPolicies((current) => {
          const next = { ...current }
          if (mode === null) delete next[policyKey]
          else next[policyKey] = mode
          return next
        })
        void runAction('setMcpPermissionModeOverride', { serverName: name, mode }, `mcp:permission:${name}`).then((result) => {
          if (result) return
          setMcpPolicies((current) => {
            const next = { ...current }
            if (previous) next[policyKey] = previous
            else delete next[policyKey]
            return next
          })
        })
      }
      return
    }
    if (key.name === 'd' && row?.endsWith(' · dynamic')) {
      const name = row.split(' · ')[0]?.trim() ?? ''
      if (name) void runAction('setMcpServers', { operation: 'remove', serverName: name }, `mcp:remove:${name}`)
      return
    }
    if (key.name === 'a') {
      const source = readDraft?.().trim() ?? ''
      if (!source) {
        setError('Put a JSON object of MCP servers in the composer first')
        return
      }
      try {
        const servers = JSON.parse(source) as unknown
        void runAction('setMcpServers', { servers }, 'mcp:set')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid MCP JSON')
      }
      return
    }
    if (key.name === 'f') {
      void runAction('listHookEvents', { query: readDraft?.().trim() ?? '', limit: 100 }, 'hooks:search')
      return
    }
    if (key.name === 'p') { void runAction('reloadPlugins', {}, 'reload-plugins'); return }
    if (key.name === 's') { void runAction('reloadSkills', {}, 'reload-skills'); return }
    if (key.name === 'g') { void runAction('resolveSettings', {}, 'resolve-settings') }
  }, [close, controls, mcpIndex, mcpPolicies, mcpRows, readDraft, runAction, session, setError, setMcpIndex, setMcpPolicies])
  useEffect(() => { registerKeys(handleKey) }, [handleKey, registerKeys])

  const docked = placement !== 'overlay'
  const scrollbarOptions = useMemo(() => ({ trackOptions: { foregroundColor: theme.muted, backgroundColor: theme.surface2 } }), [theme.muted, theme.surface2])
  if (!session && !offered) return <text fg={theme.dim}>  No session selected.</text>
  const overlayWidth = docked ? width : Math.min(76, Math.max(width - 4, 40))
  const overlayHeight = docked ? height : Math.min(height - 2, 28)
  return (
    <box
      {...popoverRootProps(docked, { top: 1, left: Math.max(1, Math.floor((width - overlayWidth) / 2)), width: overlayWidth, height: overlayHeight }, zIndex)}
      // borderStyle alone turns a border on, so a docked panel passes none.
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
    >
      <box paddingX={1} paddingTop={1} flexDirection="row" gap={1}>
        <text fg={theme.text}>DIAGNOSTICS</text>
        {loading ? <text fg={theme.dim}>· loading…</text> : null}
        {busy ? <text fg={theme.cyan}>· {busy}</text> : null}
      </box>
      {error ? (
        <box paddingX={1}>
          <text fg={theme.red} wrapMode="none">{fitText(error, overlayWidth - 4)}</text>
        </box>
      ) : null}
      {notice ? (
        <box paddingX={1}>
          <text fg={theme.green} wrapMode="none">{fitText(notice, overlayWidth - 4)}</text>
        </box>
      ) : null}
      {/* Scrollable, not clipped. Fifteen sections never fitted the 28-row
          panel, so everything past roughly the MCP list was invisible with
          nothing on screen to say so — the panel looked complete. */}
      <scrollbox
        ref={scrollRef}
        // An explicit row budget, not flexGrow: a scrollbox measures its
        // own viewport, and given flexGrow it laid itself over the title
        // row instead of sitting under it. Border (2) + title block (2) +
        // footer block (2), plus the error and notice rows when present.
        style={{ height: Math.max(overlayHeight - 6 - (error ? 1 : 0) - (notice ? 1 : 0), 3) }}
        paddingX={1}
        paddingBottom={1}
        backgroundColor={theme.surface}
        scrollY
        scrollbarOptions={scrollbarOptions}
      >
        {sections.map((section) => (
          <box key={section.id} flexDirection="column" marginTop={1} flexShrink={0}>
            <box flexShrink={0} height={1}><text fg={theme.dim}>{section.title}</text></box>
            {section.items.length === 0 || (section.items.length === 1 && section.items[0] === 'None') ? (
              <box flexShrink={0} height={1}><text fg={theme.muted}>  None</text></box>
            ) : section.id === 'mcp' && controls ? (
              section.items.map((item, idx) => {
                if (item === 'None') return <box key={idx} flexShrink={0} height={1}><text fg={theme.muted}>  None</text></box>
                const [, rawStatus] = item.split(' · ')
                const status = rawStatus?.trim() ?? ''
                const selected = idx === mcpIndex
                const serverName = item.split(' · ')[0]?.trim() ?? ''
                const policy = mcpPolicies[`${session?.sessionId ?? ''}:${serverName}`]
                return (
                  <box key={idx} flexShrink={0} height={1}>
                    <text fg={selected ? theme.cyan : (status === 'disabled' ? theme.dim : theme.text)} wrapMode="none">
                      {fitText(`  ${selected ? '▶' : ' '} ${item} · ${policy ? `applied ${policy}` : 'policy —'}`, overlayWidth - 4)}
                    </text>
                  </box>
                )
              })
            ) : (
              // No slice. This used to cap every section at 10 rows because
              // the panel clipped anyway; now that it scrolls, a cap here would
              // be a SECOND, silent truncation on top of the one the adapter
              // already applies and announces. One place truncates, and it says so.
              // Rows that share fields are a table: aligned columns, and a long
              // field wraps instead of being cut at the edge.
              diagnosticRuns(section.items).map((run) => (run.kind === 'table' ? (
                <box key={run.start} flexShrink={0} paddingLeft={2}>
                  <DiagnosticsTable rows={run.rows} theme={theme} width={overlayWidth - 7} />
                </box>
              ) : run.items.map((item, idx) => (
                <box key={run.start + idx} flexShrink={0} height={1}>
                  <text fg={theme.text} wrapMode="none">{fitText(`  ${item}`, overlayWidth - 4)}</text>
                </box>
              ))))
            )}
          </box>
        ))}
      </scrollbox>
      <box paddingX={1} paddingBottom={1}>
        <text fg={theme.dim} wrapMode="none">
          {fitText(
            controls
              ? `${mcpRows.length > 0 ? '↑↓ MCP · r reconnect · t toggle · o policy · d remove · ' : ''}⌃u/⌃d scroll · a set MCP JSON · f filter hooks · p/s/g reload · Esc close`
              : '⌃u/⌃d scroll · Esc close',
            overlayWidth - 4,
          )}
        </text>
      </box>
    </box>
  )
}
