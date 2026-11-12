'use client'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { ComposerAccessoryProps, PluginComposerModule } from '../../../lib/plugins/composer'
import type { ComponentType } from 'react'
import { SessionGoalDock } from './SessionGoalDock'

function GoalAccessory(props: ComposerAccessoryProps) {
  return <SessionGoalDock session={props.session} draft={props.draft} disabled={props.disabled} signal={props.signal}
    openRequest={props.openRequest} visible={props.visible} report={props.report}
    onStart={objective => props.services.composer!.sendDraft(objective)} />
}
export const composer: PluginComposerModule<ComponentType<ComposerAccessoryProps>> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'goals', accessories: { 'session-goal': GoalAccessory },
}
