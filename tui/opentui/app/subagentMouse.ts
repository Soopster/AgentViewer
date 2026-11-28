import type { MouseEvent } from '@opentui/core'
import type { TuiTranscriptCardLine } from '../../format'
import { openSubagentFromCard } from './windowCardActions'

let press: { threadId: string; x: number; y: number } | null = null
/** Opens on mouse UP with the pointer unmoved, like a link, so a drag stays a selection. */
export function subagentMouseProps(cardKey: string, line: TuiTranscriptCardLine) {
  const activity = line.subagent
  if (!activity) return undefined
  return {
    onMouseDown: (event: MouseEvent) => {
      press = event.button === 0 ? { threadId: activity.threadId, x: event.x, y: event.y } : null
    },
    onMouseUp: (event: MouseEvent) => {
      const down = press
      press = null
      if (event.button !== 0 || down?.threadId !== activity.threadId || down.x !== event.x || down.y !== event.y) return
      openSubagentFromCard(cardKey, activity)
    },
  }
}
