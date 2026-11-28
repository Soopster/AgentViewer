/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { type RunningSessionRef, type SendState } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { ATTACHED_DAEMON_HOST } from '../timing'

export function ExitConfirmOverlay({ exitConfirmOpen, width, composerSendState, runningSessions, exitCleanupInProgress, height, theme }: {
  exitConfirmOpen: boolean
  width: number
  composerSendState: SendState
  runningSessions: RunningSessionRef[]
  exitCleanupInProgress: boolean
  height: number
  theme: TuiThemePalette
}) {
  return (
    exitConfirmOpen ? (() => {
        const overlayWidth = Math.min(Math.max(width - 6, 32), 58)
        const overlayHeight = 8
        const turnsRunning = composerSendState === 'sending' || runningSessions.length > 0
        const exitBodyText = exitCleanupInProgress
          ? ATTACHED_DAEMON_HOST ? 'Detaching...' : 'Stopping running turns before closing...'
          : turnsRunning
            ? ATTACHED_DAEMON_HOST ? `Running turns keep going in the daemon (${ATTACHED_DAEMON_HOST}).` : 'Running turns will be interrupted before quit.'
            : 'Close the terminal viewer now?'
        // The one moment the difference matters is the moment it is too late to choose.
        const exitHintText = turnsRunning && !ATTACHED_DAEMON_HOST && !exitCleanupInProgress
          ? 'Start with --daemon next time and they keep running.'
          : ''
        const exitActionText = exitCleanupInProgress
          ? 'Cleaning up...'
          : 'Enter/Y quit  ·  Esc/N cancel'
        return (
          <box
            position="absolute"
            top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
            left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
            width={overlayWidth}
            height={overlayHeight}
            border
            borderStyle="single"
            borderColor={theme.red}
            backgroundColor={theme.surface}
            zIndex={90}
            flexDirection="column"
          >
            <box paddingX={1} paddingTop={1}>
              <text fg={theme.text}>EXIT AGENT VIEWER?</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={theme.dim} wrapMode="none">
                {fitText(exitBodyText, overlayWidth - 4)}
              </text>
            </box>
            <box paddingX={1} height={1}>
              <text fg={theme.muted} wrapMode="none">{fitText(exitHintText, overlayWidth - 4)}</text>
            </box>
            <box paddingX={1} marginTop={1}>
              <text fg={theme.red} wrapMode="none">
                {fitText(exitActionText, overlayWidth - 4)}
              </text>
            </box>
          </box>
        )
      })() : null
  )
}
