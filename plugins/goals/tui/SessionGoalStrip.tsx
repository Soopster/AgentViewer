/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import {
  SESSION_GOAL_STATUS_LABEL,
  SESSION_GOAL_STATUS_TONE,
  type SessionGoal,
} from '../../../lib/sessionGoals'
import { fitText } from '../../../tui/opentui/shell/sdk'

const TONE_COLOR: Record<'info' | 'success' | 'warning' | 'error', keyof TuiThemePalette> = {
  info: 'cyan',
  success: 'green',
  warning: 'amber',
  error: 'red',
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  return `${tokens}`
}

/**
 * One row between the transcript and the composer while a goal exists. The
 * dialog behind ⇧D does the work; this only reports state, because the goal
 * keeps running whether or not this terminal has focus.
 */
export function SessionGoalStrip({ goal, theme, width, marginLeft = 0 }: {
  goal: SessionGoal | null
  theme: TuiThemePalette
  width: number
  marginLeft?: number
}) {
  if (!goal) return null
  const tone = theme[TONE_COLOR[SESSION_GOAL_STATUS_TONE[goal.status]]]
  const head = `● ${SESSION_GOAL_STATUS_LABEL[goal.status].toUpperCase()}`
  const meta = ` ${goal.continuations}/${goal.maxContinuations} · ${formatTokens(goal.tokensUsed)}${goal.tokenBudget ? `/${formatTokens(goal.tokenBudget)}` : ''} tok · ⇧D `
  const objectiveWidth = Math.max(width - head.length - meta.length - 6, 8)
  const objective = goal.error ?? goal.lastNote ?? goal.objective
  return (
    <box
      height={1}
      flexShrink={0}
      marginLeft={marginLeft}
      width={width}
      backgroundColor={theme.surface2}
      paddingX={1}
      flexDirection="row"
      overflow="hidden"
    >
      <text fg={tone} wrapMode="none">{head}</text>
      <text fg={theme.muted} wrapMode="none">{` ${fitText(objective, objectiveWidth)} `}</text>
      <text fg={theme.dim} wrapMode="none">{meta}</text>
    </box>
  )
}
