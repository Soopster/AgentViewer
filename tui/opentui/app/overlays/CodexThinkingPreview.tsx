/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import type { ThinkingBlock } from '../../../../lib/types'
import type { TuiThemePalette } from '../../../theme'
import { reasoningLabel, latestReasoningSummary } from '../../../../lib/reasoningDisplay'
import { fitText } from '../../textLayout'

export function CodexThinkingPreview({ block, theme, width }: { block: ThinkingBlock; theme: TuiThemePalette; width: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <box height={3} paddingX={1} backgroundColor={theme.surface2}>
    <box border borderStyle="single" borderColor={theme.violet} title={` ${fitText(reasoningLabel(block, now), Math.max(16, width - 8))} `}
      titleColor={theme.violet} height={3} flexGrow={1} paddingX={1} backgroundColor={theme.surface} overflow="hidden">
      <text fg={theme.muted} wrapMode="none">{fitText(latestReasoningSummary(block.thinking) || 'Waiting for a reasoning summary…', Math.max(16, width - 8))}</text>
    </box>
  </box>
}
