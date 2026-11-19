/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import React from 'react'
import {
  SESSION_GOAL_STATUS_LABEL,
  type SessionGoal,
} from '../../../lib/sessionGoals'
import { fitText } from '../../../tui/opentui/shell/sdk'

export type SessionGoalFocus = 'objective' | 'budget'

/**
 * The goal dialog. Two fields, one focused at a time: Tab moves between the
 * objective and an optional token ceiling, Enter starts/saves, ^D clears.
 * The plugin registers modal keys with the shared accessory host; this view
 * draws the fields and owns their native focus.
 */
export function SessionGoalOverlay({
  open, goal, objective, setObjective, budget, setBudget, focus, busy, error,
  width, height, theme, onSubmit, zIndex = 70,
}: {
  open: boolean
  goal: SessionGoal | null
  objective: string
  setObjective: (value: string) => void
  budget: string
  setBudget: (value: string) => void
  focus: SessionGoalFocus
  busy: boolean
  error: string | null
  width: number
  height: number
  theme: TuiThemePalette
  onSubmit: () => void
  zIndex?: number
}) {
  if (!open) return null
  const overlayWidth = Math.min(Math.max(width - 8, 46), 78)
  const inner = overlayWidth - 4
  const overlayHeight = goal ? 13 : 12
  const accent = goal?.status === 'active' ? theme.green : theme.cyan
  const title = goal ? ` ${SESSION_GOAL_STATUS_LABEL[goal.status]} ` : ' Start a goal '
  const footer = goal
    ? `${busy ? 'Saving…' : '⏎ save'} · tab budget · ${goal.status === 'active' ? '^P pause' : '^P resume'} · ^D delete · esc cancel`
    : `${busy ? 'Starting…' : '⏎ start'} · tab budget · esc cancel`
  return (
    <box
      position="absolute"
      top={Math.max(1, Math.floor((height - overlayHeight) / 2))}
      left={Math.max(1, Math.floor((width - overlayWidth) / 2))}
      width={overlayWidth}
      height={overlayHeight}
      border
      borderStyle="single"
      borderColor={accent}
      backgroundColor={theme.surface}
      zIndex={zIndex}
      flexDirection="column"
      title={title}
      titleColor={accent}
      titleAlignment="left"
    >
      <box paddingX={1} paddingTop={1} flexDirection="column">
        <text fg={theme.dim} wrapMode="none">
          {fitText('What does done look like? The session keeps working until it is.', inner)}
        </text>
        <box marginTop={1} paddingX={1} backgroundColor={theme.surface3}>
          <input
            focused={focus === 'objective' && !busy}
            value={objective}
            onInput={setObjective}
            onSubmit={onSubmit}
          />
        </box>
        <box marginTop={1} flexDirection="row">
          <text fg={theme.dim} wrapMode="none">{'Budget '}</text>
          <box flexGrow={1} paddingX={1} backgroundColor={theme.surface3}>
            <input
              focused={focus === 'budget' && !busy}
              value={budget}
              onInput={(value: string) => setBudget(value.replace(/[^0-9]/g, ''))}
              onSubmit={onSubmit}
            />
          </box>
          <text fg={theme.dim} wrapMode="none">{' tok '}</text>
        </box>
        <box marginTop={1}>
          <text fg={error ? theme.red : theme.dim} wrapMode="none">
            {fitText(error ?? (goal?.lastNote ? `Last audit: ${goal.lastNote}` : 'An independent auditor checks progress after every turn.'), inner)}
          </text>
        </box>
        <box marginTop={1}>
          <text fg={busy ? theme.amber : theme.dim} wrapMode="none">{fitText(footer, inner)}</text>
        </box>
      </box>
    </box>
  )
}
