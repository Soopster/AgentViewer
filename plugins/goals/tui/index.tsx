/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { PluginComposerModule, ComposerAccessoryKey } from '../../../lib/plugins/composer'
import type { TuiComposerAccessoryProps } from '../../../tui/opentui/shell/sdk'
import { isCtrlKey } from '../../../tui/opentui/shell/sdk'
import { SessionGoalStrip } from './SessionGoalStrip'
import { SessionGoalOverlay } from './SessionGoalOverlay'
import { useSessionGoalState } from './useGoalState'

function GoalAccessory(props: TuiComposerAccessoryProps) {
  const goal = useSessionGoalState(props.session, props.visible, props.signal)
  const [pendingOpen, setPendingOpen] = useState(false)
  const handled = useRef({ request: 0, signal: props.signal })
  const draft = useRef(props.draft)
  draft.current = props.draft
  useEffect(() => {
    if (!props.openRequest || (handled.current.request === props.openRequest && handled.current.signal === props.signal)) return
    handled.current = { request: props.openRequest, signal: props.signal }
    setPendingOpen(true)
    void goal.refresh()
  }, [props.openRequest, props.signal, goal.refresh])
  useEffect(() => {
    if (pendingOpen && !goal.loading && !props.signal.aborted) { setPendingOpen(false); goal.openDialog(draft.current) }
  }, [pendingOpen, goal.loading, goal.openDialog, props.signal])
  useEffect(() => props.report({ rows: goal.goal ? 1 : 0, modal: goal.dialogOpen, summary: goal.goal?.objective ?? null }), [props.report, goal.goal, goal.dialogOpen])
  const key = useCallback((event: ComposerAccessoryKey) => {
    if (!goal.dialogOpen) return false
    if (event.name === 'escape') { goal.closeDialog(); return true }
    if (event.name === 'tab') { goal.setGoalFocus(current => current === 'objective' ? 'budget' : 'objective'); return true }
    if (goal.goal && isCtrlKey({ ...event, meta: Boolean(event.meta), option: false }, 'p')) { if (!goal.busy) void goal.setStatus(goal.goal.status === 'active' ? 'paused' : 'active'); return true }
    if (goal.goal && isCtrlKey({ ...event, meta: Boolean(event.meta), option: false }, 'd')) { if (!goal.busy) void goal.clear(); return true }
    return 'input' as const
  }, [goal])
  useEffect(() => { props.registerKeys(key) }, [props.registerKeys, key])
  const submit = () => {
    void (async () => {
      if (goal.goal) { await goal.save(); return }
      const objective = await goal.start()
      if (objective && !props.signal.aborted) await props.services.composer!.sendDraft(objective)
    })().catch(error => { if (!props.signal.aborted) goal.setError(error instanceof Error ? error.message : 'Could not start goal') })
  }
  return <>
    {props.visible && <SessionGoalStrip goal={goal.goal} theme={props.theme} width={props.width} marginLeft={props.marginLeft} />}
    <SessionGoalOverlay open={goal.dialogOpen} goal={goal.goal} objective={goal.objective} setObjective={goal.setObjective}
      budget={goal.budget} setBudget={goal.setBudget} focus={goal.goalFocus} busy={goal.busy} error={goal.error}
      theme={props.theme} width={props.viewportWidth} height={props.height} zIndex={props.modalZIndex} onSubmit={submit} />
  </>
}
export const composer: PluginComposerModule<ComponentType<TuiComposerAccessoryProps>> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'goals', accessories: { 'session-goal': GoalAccessory },
}
