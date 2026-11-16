/** @jsxImportSource @opentui/react */
import type { ComponentType } from 'react'
import type { PluginComposerModule } from '../../../lib/plugins/composer'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import { fitText, type TuiComposerAccessoryProps, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { useFeatureTip } from '../useFeatureTip'

function FeatureTipLine({ text, theme, width, marginLeft = 0 }: { text: string; theme: TuiThemePalette; width: number; marginLeft?: number }) {
  return <box id="feature-tip" height={1} flexShrink={0} width={width} marginLeft={marginLeft} paddingX={1} overflow="hidden" flexDirection="row">
    <text fg={theme.amber} wrapMode="none" selectable={false}>Tip: </text>
    <text fg={theme.dim} wrapMode="none" selectable={false}>{fitText(text, Math.max(0, width - 7))}</text>
  </box>
}
function TipsAccessory(props: TuiComposerAccessoryProps) {
  const tip = useFeatureTip(props, 'tui')
  return tip ? <FeatureTipLine text={tip.text} theme={props.theme} width={props.width} marginLeft={props.marginLeft} /> : null
}
export const composer: PluginComposerModule<ComponentType<TuiComposerAccessoryProps>> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'tips', accessories: { 'feature-tip': TipsAccessory },
}
