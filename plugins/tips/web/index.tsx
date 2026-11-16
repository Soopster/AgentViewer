'use client'
import type { ComponentType } from 'react'
import type { ComposerAccessoryProps, PluginComposerModule } from '../../../lib/plugins/composer'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import { useFeatureTip } from '../useFeatureTip'

function FeatureTipLine({ text }: { text: string }) {
  return <div data-feature-tip title={text} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, lineHeight: '20px', color: 'var(--text-2)' }}>
    <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Tip: </span>{text}
  </div>
}
function TipsAccessory(props: ComposerAccessoryProps) {
  const tip = useFeatureTip(props, 'web')
  return tip ? <FeatureTipLine text={tip.text} /> : null
}
export const composer: PluginComposerModule<ComponentType<ComposerAccessoryProps>> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'tips', accessories: { 'feature-tip': TipsAccessory },
}
