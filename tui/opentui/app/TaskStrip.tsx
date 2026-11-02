/** @jsxImportSource @opentui/react */
import React from 'react'
import type { TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { TASK_STRIP_EXPANDED_MAX, TODO_STRIP_GLYPH, type TaskStripState } from './todoStripModel'

/** `3/7 · Fix surface resize`: the session's todo list on one row under the transcript; a click opens the list. */
export const TaskStrip = React.memo(function TaskStrip({ state, open, onToggle, theme, accent, width }: {
  state: TaskStripState; open: boolean; onToggle: () => void; theme: TuiThemePalette; accent: string; width: number
}) {
  const shown = open ? state.todos.slice(0, TASK_STRIP_EXPANDED_MAX) : []
  const hidden = open ? state.todos.length - shown.length : 0
  const toneOf = (status: string) => status === 'completed' ? theme.dim : status === 'in_progress' ? theme.text : theme.muted
  return (
    <box flexDirection="column" flexShrink={0} paddingX={1} backgroundColor={theme.surface}
      onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); onToggle() } }}>
      <text fg={accent} wrapMode="none" selectable={false}>
        {fitText(`${open ? '▾' : '▸'} ${state.done}/${state.total} · ${state.active ?? 'todos'}${hidden > 0 ? `  (+${hidden} more)` : ''}`, width)}
      </text>
      {shown.map((todo, index) => (
        <text key={index} fg={toneOf(todo.status)} wrapMode="none" selectable={false}>
          {fitText(`  ${TODO_STRIP_GLYPH[todo.status]} ${todo.text}`, width)}
        </text>
      ))}
    </box>
  )
})
