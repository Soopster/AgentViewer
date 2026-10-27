/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type SendState, type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type TuiLiveToolActivity, type TuiEffort } from '../types'
import { type InlineTextSegment, renderInlineTextSegments, LivePreviewCard } from '../inlineText'
import { ComposerWaitingStatus } from '../chrome'
import { ComposerStatusMessage } from './ComposerStatusMessage'

type ComposerStatusStackProps = {
  presentationHidesComposer: boolean
  liveStatus: 'requesting' | 'compacting' | 'retrying' | null
  visibleComposerSending: boolean
  theme: TuiThemePalette
  width: number
  composerLiveReasoning: string
  isStreamView: boolean
  composerProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
  tuiEffort: TuiEffort
  composerThinkingTokens: number
  liveReasoningPreviewLines: string[]
  embeddedComposer: boolean
  composerTurnStatusInBorder: boolean
  isChatLikeView: boolean
  densityState: { cardGap: number; bodyIndent: number; bodyLines: number; headerRows: number; bodyPad: number; streamGap: number; streamUserGap: number; }
  composerSendStartedAt: number | null
  composerWaitingStatusSeed: string
  composerWaitingSuffix: string | null
  composerWaitingOnUser: 'Waiting for your answer' | 'Waiting for your approval' | null
  reattachedRunning: boolean
  visibleAwaitingPersistedTurn: boolean
  composerTargetSession: Session | null
  sessionDetail: TuiSessionDetail | null
  visibleLiveToolActivities: TuiLiveToolActivity[]
  visibleRunningToolCount: number
  composerActivityVisible: boolean
  liveSubagentText: Record<string, string>
  livePromptSuggestion: string | null
  composerSendState: SendState
  composerStatusMessage: string | null
  visibleComposerLiveText: string
  visibleComposerError: string | null
  liveAssistantTextCardVisible: boolean
  liveAssistantPreviewLines: string[]
  composerAccentColor: string
}

export function ComposerStatusStack(props: ComposerStatusStackProps) {
  const {
    presentationHidesComposer, liveStatus, visibleComposerSending, theme, width,
    composerLiveReasoning, isStreamView, composerProvider, tuiEffort, composerThinkingTokens,
    liveReasoningPreviewLines, embeddedComposer, composerTurnStatusInBorder, isChatLikeView,
    densityState, composerSendStartedAt, composerWaitingStatusSeed, composerWaitingSuffix,
    composerWaitingOnUser, reattachedRunning, visibleAwaitingPersistedTurn, composerTargetSession,
    sessionDetail, visibleLiveToolActivities, visibleRunningToolCount, composerActivityVisible,
    liveSubagentText, livePromptSuggestion, composerSendState, composerStatusMessage,
    visibleComposerLiveText, visibleComposerError, liveAssistantTextCardVisible,
    liveAssistantPreviewLines, composerAccentColor,
  } = props
  return (
    !presentationHidesComposer ? <>
      {(liveStatus === 'retrying' || liveStatus === 'compacting') && visibleComposerSending ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.amber} wrapMode="none">{'▌ '}</text>
          <text fg={theme.amber} wrapMode="none">
            {fitText(
              liveStatus === 'retrying'
                ? '● Retrying after a transient error…'
                : '● Compacting conversation to free up context…',
              Math.max(width - 6, 16),
            )}
          </text>
        </box>
      ) : null}

      {visibleComposerSending && composerLiveReasoning.trim() && !isStreamView ? (
        <LivePreviewCard
          title={`✻ THINKING · ${String(composerProvider ?? 'agent').toUpperCase()} · ${tuiEffort.toUpperCase()}${composerThinkingTokens > 0 ? ` · ~${composerThinkingTokens >= 1000 ? `${(composerThinkingTokens / 1000).toFixed(1)}k` : composerThinkingTokens} tok` : ''}`}
          lines={liveReasoningPreviewLines}
          accentColor={theme.violet}
          bodyColor={theme.muted}
          theme={theme}
        />
      ) : null}

      {/* Pinned for the whole turn — elapsed + token counter + interrupt hint
          must not vanish the moment the first delta or tool arrives, which is
          how the native Claude CLI status line behaves. */}
      {visibleComposerSending && !embeddedComposer && !composerTurnStatusInBorder ? (
        <box
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          paddingLeft={isChatLikeView ? densityState.bodyIndent : 1}
          height={1}
          flexShrink={0}
          flexDirection="row"
        >
          <text fg={theme.cyan} wrapMode="none">{isChatLikeView ? '● ' : '▌ '}</text>
          <box flexGrow={1}>
            <ComposerWaitingStatus
              startedAt={composerSendStartedAt}
              seed={composerWaitingStatusSeed}
              suffix={composerWaitingSuffix}
              theme={theme}
              width={Math.max(width - 6, 16)}
              message={composerWaitingOnUser}
            />
          </box>
        </box>
      ) : null}

      {!visibleComposerSending && reattachedRunning && !visibleAwaitingPersistedTurn && !embeddedComposer ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.cyan} wrapMode="none">{'▌ '}</text>
          <text fg={theme.muted} wrapMode="none">
            {fitText('● Turn running · reattached — output syncs as it persists · ⌃C interrupt', Math.max(width - 6, 16))}
          </text>
        </box>
      ) : null}

      {composerTargetSession?.provider === 'codex' && sessionDetail?.externalWriter ? (
        <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
          <text fg={theme.amber} wrapMode="none">{'▌ '}</text>
          <text fg={theme.muted} wrapMode="none">
            {fitText('● Open in another Codex client — transcript will lag until that turn finishes', Math.max(width - 6, 16))}
          </text>
        </box>
      ) : null}

      {visibleLiveToolActivities.length > 0 && visibleRunningToolCount > 0 ? (
        <box
          backgroundColor={isChatLikeView ? theme.surface : theme.surface2}
          paddingLeft={isChatLikeView ? densityState.bodyIndent : 1}
          paddingTop={isChatLikeView ? 0 : 1}
          flexDirection="row"
        >
          <text fg={theme.green} wrapMode="none">{isChatLikeView ? '● ' : '▌ '}</text>
          <text wrapMode="none">
            {renderInlineTextSegments([
              { text: 'tools  ', fg: theme.dim },
              ...visibleLiveToolActivities.flatMap((a, i): InlineTextSegment[] => [
                ...(i > 0 ? [{ text: '  ', fg: theme.dim }] : []),
                { text: a.label, fg: a.status === 'running' ? theme.text : theme.muted },
                { text: a.status === 'running' ? ' ●' : ' ✓', fg: a.status === 'running' ? theme.green : theme.dim },
              ]),
            ], Math.max(width - 6, 16), theme.dim)}
          </text>
        </box>
      ) : null}

      {composerActivityVisible ? (() => {
        const subagentEntries = Object.entries(liveSubagentText).filter(([, text]) => text.trim().length > 0)
        if (subagentEntries.length === 0) return null
        const [, latest] = subagentEntries[subagentEntries.length - 1]
        const tail = latest.replace(/\s+/g, ' ').trim().slice(-80)
        return (
          <box backgroundColor={theme.surface2} paddingX={1} paddingTop={1} flexDirection="row">
            <text fg={theme.pink} wrapMode="none">{'▌ '}</text>
            <text fg={theme.dim} wrapMode="none">
              {fitText(`↪ subagent · ${tail}`, Math.max(width - 6, 16))}
            </text>
          </box>
        )
      })() : null}

      {livePromptSuggestion && composerSendState !== 'sending' ? (
        <box backgroundColor={theme.surface} paddingX={1} paddingTop={1}>
          <text fg={theme.cyan} wrapMode="none">
            {fitText(`Tab → ${livePromptSuggestion}`, Math.max(width - 4, 20))}
          </text>
        </box>
      ) : null}

      <ComposerStatusMessage composerStatusMessage={composerStatusMessage} visibleComposerSending={visibleComposerSending} visibleComposerLiveText={visibleComposerLiveText} visibleComposerError={visibleComposerError} isChatLikeView={isChatLikeView} liveAssistantTextCardVisible={liveAssistantTextCardVisible} composerProvider={composerProvider} liveAssistantPreviewLines={liveAssistantPreviewLines} composerAccentColor={composerAccentColor} theme={theme} visibleAwaitingPersistedTurn={visibleAwaitingPersistedTurn} width={width} />

      </> : null
  )
}
