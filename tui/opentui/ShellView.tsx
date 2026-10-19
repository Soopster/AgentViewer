/** @jsxImportSource @opentui/react */
// One interactive shell's screen, painted from its emulator. It subscribes to
// the shell store itself, so a shell redrawing sixty times a second re-renders
// this view and nothing above it.
import { useEffect, useMemo, useSyncExternalStore } from 'react'

import type { TuiThemePalette } from '../theme'
import { readScreenRuns } from './shellScreen'
import { getShells, resizeShell, shellTerminal, subscribeShells } from './shellStore'

export function ShellView({
  shellId,
  theme,
  width,
  height,
  showCursor,
  scrollBack,
}: {
  shellId: string
  theme: TuiThemePalette
  width: number
  height: number
  showCursor: boolean
  scrollBack: number
}) {
  const shells = useSyncExternalStore(subscribeShells, getShells, getShells)
  const shell = shells.find((entry) => entry.id === shellId) ?? null

  // The PTY is told the pane's size, so line editing and full-screen programs wrap where the pane does.
  useEffect(() => { resizeShell(shellId, width, height) }, [height, shellId, width])

  const runs = useMemo(() => {
    const term = shellTerminal(shellId)
    return term ? readScreenRuns(term, theme, { scrollBack, showCursor }) : []
    // `version` is what says the screen changed; the emulator itself is mutable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.version, shellId, scrollBack, showCursor, theme])

  if (!shell) return <text fg={theme.dim}>This shell has closed.</text>
  if (shell.error) return <text fg={theme.red} wrapMode="word" width={width}>{shell.error}</text>

  return (
    <box height={height} width={width} overflow="hidden">
      {/* One text for the screen: a renderable per row is what a redraw per keystroke would cost. */}
      <text wrapMode="none">
        {runs.map((row, index) => (
          <span key={index}>
            {row.length === 0 ? ' ' : row.map((run, part) => (
              <span key={part} fg={run.fg} bg={run.bg} attributes={run.attributes}>{run.text}</span>
            ))}
            {index < runs.length - 1 ? '\n' : ''}
          </span>
        ))}
      </text>
    </box>
  )
}
