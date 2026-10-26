/** @jsxImportSource @opentui/react */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getLoadingProviders, getServerLoadingProviders, providerLoadingLabel, subscribeLoadingProviders } from '../../lib/providerLoading'
import type { TuiThemePalette } from '../theme'
import { getToasts, subscribeToasts, type Toast, type ToastKind } from './toastStore'

// Read the module-level toast store. getToasts returns the same array reference
// when nothing changed, so this only re-renders on real updates.
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts)
}

function accentFor(kind: ToastKind, theme: TuiThemePalette): string {
  switch (kind) {
    case 'success': return theme.green
    case 'error': return theme.red
    case 'warning': return theme.amber
    case 'info': return theme.cyan
    default: return theme.violet
  }
}

// BMP-safe leading glyphs (the store already sanitizes the message text).
const ICON: Record<ToastKind, string> = {
  default: '●',
  success: '✓',
  error: '✕',
  info: '●',
  warning: '▲',
}

// A toast is as wide as its message up to the screen, so a long path fits on
// one row where the terminal allows, and wraps onto further rows where it does not.
const DEFAULT_TOAST_WIDTH = 46
export function toastWidthFor(messages: readonly string[], width: number): number {
  const widest = messages.reduce((max, message) => Math.max(max, message.length + 6), 0)
  return Math.min(Math.max(width - 4, 24), Math.max(DEFAULT_TOAST_WIDTH, widest))
}

/** Content rows a message takes at an inner width (the glyph and a space lead the first). */
export function toastContentRows(message: string, innerWidth: number): number {
  return Math.max(1, Math.ceil((message.length + 2) / Math.max(1, innerWidth)))
}

/** Rows beyond one per toast that wrapping adds, for the stack's height. */
export function toastExtraRows(messages: readonly string[], width: number): number {
  const inner = toastWidthFor(messages, width) - 4
  return messages.reduce((sum, message) => sum + toastContentRows(message, inner) - 1, 0)
}

/** The row the toast stack starts on; overlays that must stay readable end above it. */
export function toastStackTop(count: number, height: number, extraRows = 0): number {
  const stackHeight = count * 3 + extraRows + Math.max(count - 1, 0)
  return Math.max(1, height - stackHeight - 3)
}

// Floating, bottom-right toast stack. Each toast is a single bordered row so the
// stack height is predictable; the whole overlay is absolutely positioned above
// the transcript (zIndex below the exit-confirm modal backdrop at 89).
export function ToastOverlay({
  toasts,
  theme,
  width,
  height,
  zIndex = 80,
}: {
  toasts: Toast[]
  theme: TuiThemePalette
  width: number
  height: number
  zIndex?: number
}) {
  const providers = useSyncExternalStore(subscribeLoadingProviders, getLoadingProviders, getServerLoadingProviders)
  const [frame, setFrame] = useState(0)
  const loading = providers.length > 0
  useEffect(() => {
    if (!loading) return
    const timer = setInterval(() => setFrame(value => (value + 1) % 4), 160)
    return () => clearInterval(timer)
  }, [loading])
  const items: Toast[] = [
    ...toasts,
    ...providers.map((provider, index) => ({ id: -index - 1, kind: 'info' as const, message: providerLoadingLabel(provider) })),
  ]
  if (items.length === 0) return null
  const messages = items.map(item => item.message)
  const toastWidth = toastWidthFor(messages, width)
  const left = Math.max(1, width - toastWidth - 2)
  const gap = 1
  // Each toast is three rows (border + one content row); anchored just above
  // the bottom edge, leaving room for the composer/footer.
  const top = toastStackTop(items.length, height, toastExtraRows(messages, width))
  const innerWidth = toastWidth - 4
  return (
    <box position="absolute" top={top} left={left} width={toastWidth} flexDirection="column" gap={gap} zIndex={zIndex}>
      {items.map((toastItem) => {
        const accent = accentFor(toastItem.kind, theme)
        return (
          <box
            key={toastItem.id}
            width={toastWidth}
            border
            borderStyle="rounded"
            borderColor={accent}
            backgroundColor={theme.surface2}
            paddingX={1}
          >
            <text fg={accent} wrapMode="char">
              {`${toastItem.id < 0 ? ['◐', '◓', '◑', '◒'][frame] : ICON[toastItem.kind]} ${toastItem.message}`}
            </text>
          </box>
        )
      })}
    </box>
  )
}
