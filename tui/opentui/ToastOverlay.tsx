/** @jsxImportSource @opentui/react */
import { useSyncExternalStore } from 'react'
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

function fit(text: string, max: number): string {
  if (max <= 1) return ''
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
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
  if (toasts.length === 0) return null
  const toastWidth = Math.min(Math.max(width - 4, 24), 46)
  const left = Math.max(1, width - toastWidth - 2)
  const gap = 1
  const rowsPerToast = 3 // border (2) + one content row
  const stackHeight = toasts.length * rowsPerToast + (toasts.length - 1) * gap
  // Anchor just above the bottom edge, leaving room for the composer/footer.
  const top = Math.max(1, height - stackHeight - 3)
  const innerWidth = toastWidth - 4
  return (
    <box position="absolute" top={top} left={left} width={toastWidth} flexDirection="column" gap={gap} zIndex={zIndex}>
      {toasts.map((toastItem) => {
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
            <text fg={accent} wrapMode="none">
              {fit(`${ICON[toastItem.kind]} ${toastItem.message}`, innerWidth)}
            </text>
          </box>
        )
      })}
    </box>
  )
}
