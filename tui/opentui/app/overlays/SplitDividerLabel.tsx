/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { WindowLayout } from '../../windowLayout'
import { type WindowGroupKey } from '../../windowLayout'
import { SPLIT_SHARE_EVEN } from '../../splitPaneState'

export function SplitDividerLabel({ splitDividerDragging, splitDividerPoint, width, theme, fittedWindows, splitSecondaryShare, arrangedLayout, splitReaderShare, rightPaneWidth, readerRowBudget }: {
  splitDividerDragging: 'primary' | 'secondary' | { group: WindowGroupKey; index: number; } | null
  splitDividerPoint: { x: number; y: number; } | null
  width: number
  theme: TuiThemePalette
  fittedWindows: WindowLayout
  splitSecondaryShare: number
  arrangedLayout: WindowLayout | null
  splitReaderShare: number
  rightPaneWidth: number
  readerRowBudget: number
}) {
  return (
    splitDividerDragging && splitDividerPoint ? (
        // The size the drag is setting, beside the pointer.
        <box
          id="split-divider-readout"
          position="absolute"
          top={Math.max(0, splitDividerPoint.y - 1)}
          left={Math.min(Math.max(0, splitDividerPoint.x + 2), Math.max(0, width - 24))}
          height={1}
          zIndex={901}
          backgroundColor={theme.cyan}
          paddingX={1}
        >
          <text fg={theme.bg} wrapMode="none" selectable={false}>
            {splitDividerDragging && typeof splitDividerDragging === 'object'
              ? (() => {
                  const group = fittedWindows.groups.find((entry) => entry.key === splitDividerDragging.group)
                  const member = group?.members[splitDividerDragging.index]
                  const pane = member === undefined ? undefined : fittedWindows.panes[member]
                  return group?.axis === 'y' ? `${pane?.height ?? 0} rows · pane ${(member ?? 0) + 1}` : `${pane?.width ?? 0} cols · pane ${(member ?? 0) + 1}`
                })()
              : splitDividerDragging === 'secondary'
              ? `top ${Math.round((splitSecondaryShare === SPLIT_SHARE_EVEN ? 0.5 : splitSecondaryShare) * 100)}% · ${arrangedLayout?.panes[0]?.height ?? 0} rows`
              : `reader ${Math.round((splitReaderShare === SPLIT_SHARE_EVEN ? 0.5 : splitReaderShare) * 100)}% · ${rightPaneWidth}×${readerRowBudget}`}
          </text>
        </box>
      ) : null
  )
}
