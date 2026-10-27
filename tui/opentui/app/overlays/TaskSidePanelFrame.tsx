/** @jsxImportSource @opentui/react */
import type { OpenCodeTodo } from '../../../../lib/taskRegistry'
import type { TuiThemePalette } from '../../../theme'
import { TaskSidePanel } from '../../TaskSidePanel'
import { type TuiTranscriptCard } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type Session } from '../../../../lib/types'

export function TaskSidePanelFrame({ taskPanelVisible, effectiveSurfacePanelWidth, effectiveTaskPanelWidth, surfacePanelHeight, taskPanelMessages, composerLiveTodos, selectedSession, theme, visibleTranscriptCards, jumpToTranscriptIndex, taskPanelTab, liveSubagentText }: {
  taskPanelVisible: boolean
  effectiveSurfacePanelWidth: number
  effectiveTaskPanelWidth: number
  surfacePanelHeight: number
  taskPanelMessages: ThreadedMessage[]
  composerLiveTodos: OpenCodeTodo[]
  selectedSession: Session | null
  theme: TuiThemePalette
  visibleTranscriptCards: TuiTranscriptCard[]
  jumpToTranscriptIndex: (index: number) => void
  taskPanelTab: 'agents' | 'tasks'
  liveSubagentText: Record<string, string>
}) {
  return (
    taskPanelVisible ? (
          <box
            id="task-side-panel-frame"
            position="absolute"
            top={0}
            right={effectiveSurfacePanelWidth}
            width={effectiveTaskPanelWidth}
            height={surfacePanelHeight}
            overflow="hidden"
            zIndex={4}
          >
            <TaskSidePanel
              messages={taskPanelMessages}
              todos={composerLiveTodos}
              session={selectedSession}
              theme={theme}
              width={effectiveTaskPanelWidth}
              height={surfacePanelHeight}
              onSelectTask={(uuid) => {
                const idx = visibleTranscriptCards.findIndex((c) => c.key === uuid)
                if (idx >= 0) jumpToTranscriptIndex(idx)
              }}
              tab={taskPanelTab}
              liveSubagentText={liveSubagentText}
            />
          </box>
        ) : null
  )
}
