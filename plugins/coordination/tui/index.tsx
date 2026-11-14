/** @jsxImportSource @opentui/react */
// TUI entry for the Coordination plugin: loaded on first open, never at boot.
// The views read the runs and the conversation's team from the host; closing
// or turning them off stops no run, teammate or sweep.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { CoordinationPopover } from './CoordinationPopover'
import { TeammatesPopover } from './TeammatesPopover'
import { NewWorkflowSurface } from './NewWorkflowSurface'
import { PlaybookManagerPopover } from './PlaybookManagerPopover'

const NO_NOTICES = () => {}

function ControlCenterSurface({ services, theme, width, height, placement, registerKeys, close, detach, runCommand }: TuiPluginViewProps) {
  const coordination = services.coordination!
  const composer = services.composer
  return (
    <CoordinationPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      initialRunId={coordination.initialRunId}
      onOpenSession={coordination.openAgentSession}
      onWatchRun={coordination.watchRun}
      onNewRun={() => { runCommand('coord-start') }}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onCopyJoinCommand={coordination.copyJoinCommand}
      onSendDiffNoteToComposer={composer?.appendDiffNote}
      onKeyHandlerReady={registerKeys}
      {...(detach ? { onDetach: detach } : {})}
    />
  )
}

function TeammatesSurface({ services, theme, width, height, placement, registerKeys, detach }: TuiPluginViewProps) {
  const coordination = services.coordination!
  return (
    <TeammatesPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      onOpenSession={coordination.openAgentSession}
      onWatchSessions={coordination.watchAgentSessions}
      onWatchRun={coordination.watchRun}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      {...(detach ? { onDetach: detach } : {})}
    />
  )
}

function PlaybooksSurface({ services, useState, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  return <PlaybookManagerPopover
    key={services.repository!.cwd}
    service={services.playbooks!}
    useState={useState}
    cwd={services.repository!.cwd}
    theme={theme} width={width} height={height}
    docked={placement !== 'overlay'}
    onClose={close}
    onNotice={services.notices?.show ?? NO_NOTICES}
    onKeyHandlerReady={registerKeys}
    {...(detach ? { onDetach: detach } : {})}
  />
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'coordination',
  views: { coordination: ControlCenterSurface, teammates: TeammatesSurface, playbooks: PlaybooksSurface, 'new-workflow': NewWorkflowSurface },
}

