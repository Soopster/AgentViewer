/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { filterWindowTargets, type WindowTarget } from './windowTargets'
import { fitText } from './textLayout'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

export function WindowSwitcherPopover({ targets, theme, width, height, onPick, onClose, onKeyHandlerReady }: {
  targets: WindowTarget[]; theme: TuiThemePalette; width: number; height: number
  onPick: (key: string) => void; onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef(0)
  const matches = useMemo(() => filterWindowTargets(targets, query), [targets, query])
  const index = Math.min(cursor, Math.max(0, matches.length - 1))
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  cursorRef.current = index
  const popW = Math.max(20, Math.min(width - 2, 94))
  const popH = Math.max(8, Math.min(height - 2, 23))
  const pageSize = Math.max(1, Math.floor((popH - 6) / 2))
  const start = Math.floor(index / pageSize) * pageSize
  const handleKey = useCallback((key: Key) => {
    if (key.name === 'escape') { onClose(); return true }
    if (key.name === 'down' || key.name === 'tab') { cursorRef.current = (cursorRef.current + 1) % Math.max(1, matchesRef.current.length); setCursor(cursorRef.current); return true }
    if (key.name === 'up') { cursorRef.current = (cursorRef.current + matchesRef.current.length - 1) % Math.max(1, matchesRef.current.length); setCursor(cursorRef.current); return true }
    if (key.name === 'return') { const target = matchesRef.current[cursorRef.current]; if (target) onPick(target.key); return true }
    return false
  }, [index, matches, onClose, onPick])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  return (
    <box id="window-switcher" position="absolute" left={Math.max(0, Math.floor((width - popW) / 2))} top={Math.max(0, Math.floor((height - popH) / 2))}
      width={popW} height={popH} border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface}
      zIndex={MODAL_CONTENT_Z_INDEX} paddingX={1} flexDirection="column">
      <text fg={theme.cyan} wrapMode="none">Switch window</text>
      <input id="window-switcher:query" focused value={query} placeholder="Search title, provider, or project…"
        onInput={(value: string) => { matchesRef.current = filterWindowTargets(targets, value); cursorRef.current = 0; setQuery(value); setCursor(0) }} />
      <box flexGrow={1} flexDirection="column" overflow="hidden">
        {matches.length === 0 ? <text fg={theme.dim}>No matching windows</text> : matches.slice(start, start + pageSize).map((target, offset) => (
          <box key={target.key} id={`window-switcher:target:${target.key}`} height={2} flexShrink={0} flexDirection="column"
            backgroundColor={index === start + offset ? theme.surface3 : undefined}
            onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); onPick(target.key) } }}>
            <text fg={index === start + offset ? theme.cyan : theme.text} wrapMode="none">{fitText(`${index === start + offset ? '›' : ' '} ${target.title}`, popW - 4)}</text>
            <text fg={theme.dim} wrapMode="none">{fitText(`  ${target.detail}`, popW - 4)}</text>
          </box>
        ))}
      </box>
      <text fg={theme.dim} wrapMode="none">{`${matches.length} windows · ↑↓ choose · enter focus · esc close`}</text>
    </box>
  )
}
