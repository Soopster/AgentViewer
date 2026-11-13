/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../../tui/opentui/shell/sdk'
import type { PluginSessionInsightsService } from '../../../../lib/plugins/sessionInsights'
import type { PersistedSearchResult } from '../../../../lib/session-index/types'
import type { Session } from '../../../../lib/types'
import { changeFacet, DATE_FACETS, EMPTY_FACETS, editText, searchParamsFor, stepField, type SearchFacets, type SearchField } from './model'

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  sessions: readonly Session[]
  insights: PluginSessionInsightsService
  onOpenSession: (session: Session) => void
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
  docked?: boolean
}

const DEBOUNCE_MS = 200
const baseName = (cwd: string | undefined) => (cwd ? cwd.split('/').filter(Boolean).pop() ?? cwd : '')

export function SessionSearchPopover({ theme, width, height, sessions, insights, onOpenSession, onClose, onDetach, onKeyHandlerReady, docked = false }: Props) {
  const [facets, setFacets] = useState<SearchFacets>(EMPTY_FACETS)
  const [field, setField] = useState<SearchField>('query')
  const [results, setResults] = useState<PersistedSearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'error'>('idle')
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState(0)
  const generation = useRef(0)

  // Debounced, and only the newest answer is kept: each keystroke supersedes the last.
  useEffect(() => {
    const params = searchParamsFor(facets, Date.now())
    if (!params) { generation.current += 1; setResults([]); setStatus('idle'); return }
    const mine = ++generation.current
    setStatus('searching')
    const timer = setTimeout(() => {
      insights.search(params)
        .then((response) => { if (mine === generation.current) { setResults(response.results); setCursor(0); setStatus('idle') } })
        .catch((failure) => { if (mine === generation.current) { setError(failure instanceof Error ? failure.message : 'Search failed'); setStatus('error') } })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [facets])

  // The sidebar list is one page of the current provider; an index hit is often outside it. A tab
  // does not need a list entry, so a hit that is not listed opens from what the index recorded.
  const open = useCallback((result: PersistedSearchResult | undefined) => {
    if (!result) return
    const record = result.session
    const found = sessions.find((session) => session.provider === record.provider && session.sessionId === record.sessionId)
    if (found) { onOpenSession(found); return }
    // The index key is `<instance or provider>:<session id>`; a prefix other than the provider names the instance.
    const prefix = record.key.slice(0, Math.max(record.key.length - record.sessionId.length - 1, 0))
    onOpenSession({
      sessionId: record.sessionId,
      provider: record.provider,
      ...(prefix && prefix !== record.provider ? { providerInstanceId: prefix } : {}),
      cwd: record.cwd,
      summary: record.summary ?? record.title,
      customTitle: record.customTitle,
      firstPrompt: record.firstPrompt,
      lastModified: record.lastModified,
      createdAt: record.createdAt,
    })
  }, [onOpenSession, sessions])

  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'tab') { setField((current) => stepField(current, key.shift ? -1 : 1)); return }
    if (key.name === 'down' || (key.ctrl && key.name === 'n')) { setCursor((value) => Math.min(value + 1, Math.max(results.length - 1, 0))); return }
    if (key.name === 'up' || (key.ctrl && key.name === 'p')) { setCursor((value) => Math.max(value - 1, 0)); return }
    if (key.name === 'return') { open(results[cursor]); return }
    if (field === 'query' || field === 'file') {
      const slot = field === 'query' ? 'query' : 'touchedFile'
      const next = editText(facets[slot], key)
      if (next !== null) setFacets((current) => ({ ...current, [slot]: next }))
      return
    }
    const delta = key.name === 'left' ? -1 : 1
    if (key.name === 'left' || key.name === 'right' || key.name === 'space' || key.sequence === ' ') {
      setFacets((current) => changeFacet(current, field, delta) ?? current)
    }
  }, [cursor, facets, field, onClose, open, results])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 110)
  const popH = docked ? height : Math.min(height - 4, 30)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = Math.max(popW - frame - 2, 30)
  const listRows = Math.max(popH - frame - 5, 3)
  const clip = (text: string, limit = innerW) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)
  const top = Math.max(0, Math.min(cursor - Math.floor(listRows / 2), Math.max(results.length - listRows, 0)))
  const dateLabel = DATE_FACETS.find((entry) => entry.id === facets.date)?.label ?? ''
  const mark = (name: SearchField) => (field === name ? theme.cyan : theme.muted)
  const caret = (name: SearchField) => (field === name ? '▏' : '')
  const summary = useMemo(() => {
    if (status === 'error') return error
    if (!facets.query.trim()) return 'Type to search every indexed session'
    if (status === 'searching') return 'Searching…'
    return `${results.length} session${results.length === 1 ? '' : 's'}`
  }, [error, facets.query, results.length, status])

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, 50)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Session search '}
      titleAlignment="left"
      paddingX={1}
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <text fg={mark('query')} wrapMode="none">{clip(`⌕ ${facets.query}${caret('query')}${facets.query || field === 'query' ? '' : '…'}`)}</text>
      <box flexDirection="row">
        <text fg={mark('provider')} wrapMode="none">{`provider: ${facets.provider}   `}</text>
        <text fg={mark('date')} wrapMode="none">{`date: ${dateLabel}   `}</text>
        <text fg={mark('errors')} wrapMode="none">{`errors: ${facets.hasError ? 'only' : 'any'}   `}</text>
        <text fg={mark('file')} wrapMode="none">{`file: ${facets.touchedFile}${caret('file')}${facets.touchedFile || field === 'file' ? '' : '—'}`}</text>
      </box>
      <text fg={status === 'error' ? theme.red : theme.dim} wrapMode="none">{clip(summary)}</text>
      <box flexDirection="column" height={listRows}>
        {results.slice(top, top + listRows).map((result, index) => {
          const selected = top + index === cursor
          const snippet = result.matches[0]?.snippet?.replace(/\s+/g, ' ') ?? ''
          const where = [result.session.provider, baseName(result.session.cwd)].filter(Boolean).join(' · ')
          return (
            <text key={result.session.key} fg={selected ? theme.text : theme.muted} bg={selected ? theme.surface3 : undefined} wrapMode="none">
              {clip(`${selected ? '▎' : ' '} ${result.session.title}  ·  ${where}${snippet ? `  —  ${snippet}` : ''}`)}
            </text>
          )
        })}
      </box>
      <box flexGrow={1} />
      <text fg={theme.dim} wrapMode="none">{clip('tab field · ←/→ change · ↑/↓ results · enter open · esc close')}</text>
    </box>
  )
}
