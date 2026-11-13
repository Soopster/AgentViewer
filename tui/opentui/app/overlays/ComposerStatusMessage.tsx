/** @jsxImportSource @opentui/react */
import type { AgentProvider } from '../../../../lib/types'
import type { TuiThemePalette } from '../../../theme'
import { fitText } from '../../textLayout'
import { LivePreviewCard } from '../inlineText'
import { Spinner } from '../chrome'

export function ComposerStatusMessage({ composerStatusMessage, visibleComposerSending, visibleComposerLiveText, visibleComposerError, hideLiveText, liveAssistantTextCardVisible, composerProvider, liveAssistantPreviewLines, composerAccentColor, theme, visibleAwaitingPersistedTurn, width }: {
  composerStatusMessage: string | null
  visibleComposerSending: boolean
  visibleComposerLiveText: string
  visibleComposerError: string | null
  /** The view draws the streaming reply in the transcript, not above the composer. */
  hideLiveText: boolean
  liveAssistantTextCardVisible: boolean
  composerProvider: AgentProvider | null
  liveAssistantPreviewLines: string[]
  composerAccentColor: string
  theme: TuiThemePalette
  visibleAwaitingPersistedTurn: boolean
  width: number
}) {
  return (
    composerStatusMessage ? (
        visibleComposerSending && visibleComposerLiveText && !visibleComposerError ? (
          hideLiveText || liveAssistantTextCardVisible ? null : (
            <LivePreviewCard
              title={`● ASSISTANT · ${String(composerProvider ?? 'agent').toUpperCase()} · STREAMING`}
              lines={liveAssistantPreviewLines}
              accentColor={composerAccentColor}
              bodyColor={theme.text}
              theme={theme}
            />
          )
        ) : visibleAwaitingPersistedTurn && !visibleComposerError ? (
          // Reconciling a still-running turn (stall recovery or the brief
          // window after completion before persisted rows land) is not idle —
          // an animated spinner here, not static dim text, is what tells the
          // idle-ticker exclusion above the truth on screen too.
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <Spinner label={fitText(composerStatusMessage, Math.max(width - 6, 16))} fg={theme.cyan} labelFg={theme.dim} />
          </box>
        ) : (
          <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
            <text fg={visibleComposerError ? theme.red : theme.dim} wrapMode="none">
              {fitText(
                composerStatusMessage,
                Math.max(width - 4, 20),
              )}
            </text>
          </box>
        )
      ) : null
  )
}
