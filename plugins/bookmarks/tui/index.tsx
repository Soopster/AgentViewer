/** @jsxImportSource @opentui/react */
// TUI entry for the Bookmarks plugin: loaded on first open, never at boot.
import { useEffect, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { MessageBookmark } from '../../../lib/messageBookmarks'
import { fitText, type TuiPluginView, type TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function BookmarksSurface({ services, theme, width, height, placement, zIndex, registerKeys, close }: TuiPluginViewProps) {
  const service = services.bookmarks!
  const navigation = services['session-navigation']!
  const [records, setRecords] = useState<MessageBookmark[] | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    service.list(controller.signal)
      .then(all => { if (!controller.signal.aborted) setRecords(all) })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setRecords([])
        services.notices?.show('error', err instanceof Error ? err.message : 'Failed to load bookmarks')
      })
    return () => controller.abort()
  }, [service])

  const list = records ?? []
  useEffect(() => {
    registerKeys((key) => {
      if (key.name === 'escape' || key.name === 'q' || (key.shift && key.name === 'b') || (key.ctrl && key.name === 'c')) { close(); return true }
      if (list.length === 0) return true
      if (key.name === 'j' || key.name === 'down') { setIndex(i => Math.min(i + 1, list.length - 1)); return true }
      if (key.name === 'k' || key.name === 'up') { setIndex(i => Math.max(i - 1, 0)); return true }
      if (key.name === 'return') {
        const record = list[index]
        if (record) {
          if (placement === 'overlay') close()
          navigation.open({ sessionId: record.sessionId, provider: record.provider }, record.uuid)
        }
        return true
      }
      if (key.sequence === 'x' || key.name === 'delete') {
        const record = list[index]
        if (!record) return true
        setRecords(current => (current ?? []).filter(entry => entry !== record))
        setIndex(i => Math.max(Math.min(i, list.length - 2), 0))
        service.remove(record).catch((err: unknown) => services.notices?.show('error', err instanceof Error ? err.message : 'Could not remove the bookmark'))
        return true
      }
      return placement === 'overlay'
    })
    return () => registerKeys(null)
  }, [registerKeys, list, index, placement, close, navigation, service, services.notices])

  const docked = placement !== 'overlay'
  const overlayW = docked ? width : Math.min(width - 6, 88)
  const labelW = overlayW - 4
  const maxRows = Math.max(Math.min(list.length, docked ? height - 3 : height - 8), 1)
  const startIdx = clamp(index - Math.floor(maxRows / 2), 0, Math.max(0, list.length - maxRows))
  const visible = list.slice(startIdx, startIdx + maxRows)
  const header = `★ BOOKMARKS  ·  ${records ? `${list.length} saved` : 'loading…'}  ·  j/k move  ·  enter open  ·  x remove  ·  esc close`
  return (
    <box
      {...(docked
        ? { width, height }
        : { position: 'absolute' as const, top: 4, left: Math.max(Math.floor((width - overlayW) / 2), 2), width: overlayW, zIndex, border: true, borderStyle: 'single' as const, borderColor: theme.amber })}
      backgroundColor={theme.surface}
      flexDirection="column"
    >
      <box paddingX={1} paddingTop={docked ? 0 : 1} backgroundColor={theme.surface2}>
        <text fg={theme.amber}>{fitText(header, overlayW - 4)}</text>
      </box>
      {records && list.length === 0 ? (
        <box paddingX={1} paddingY={1}>
          <text fg={theme.dim}>No bookmarks yet — press b on a message to save one.</text>
        </box>
      ) : visible.map((record, i) => {
        const selected = startIdx + i === index
        const title = record.sessionTitle || 'Untitled session'
        const preview = (record.preview || '').replace(/\s+/g, ' ').trim()
        return (
          <box key={`${record.provider}:${record.sessionId}:${record.uuid}`} paddingX={1} backgroundColor={selected ? theme.surface3 : theme.surface} flexDirection="column">
            <box flexDirection="row">
              <text fg={selected ? theme.cyan : theme.amber} wrapMode="none">{`${selected ? '> ' : '  '}[${record.provider}] `}</text>
              <text fg={selected ? theme.text : theme.muted} wrapMode="none">{fitText(title, labelW - record.provider.length - 6)}</text>
            </box>
            {preview ? (
              <box paddingLeft={2}>
                <text fg={theme.dim} wrapMode="none">{fitText(preview, labelW - 2)}</text>
              </box>
            ) : null}
          </box>
        )
      })}
    </box>
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'bookmarks',
  views: { bookmarks: BookmarksSurface },
}
