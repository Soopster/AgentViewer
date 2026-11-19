import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ComposerAccessoryProps } from '../../lib/plugins/composer'
import { useDisabledPlugins } from '../../lib/plugins/useDisabledPlugins'
import type { PluginRenderer } from '../../lib/plugins/types'
import { listFeatureTips } from './catalog'
import { createTipScheduler } from './model'

// Shared across target switches and accessory remounts, separate per renderer.
const schedulers = { web: createTipScheduler(), tui: createTipScheduler() }
export function useFeatureTip(props: ComposerAccessoryProps, renderer: PluginRenderer) {
  const disabled = useDisabledPlugins()
  const tips = useMemo(() => listFeatureTips(renderer, props.session, Boolean(props.cwd)), [renderer, props.session, props.cwd, disabled])
  const scheduler = schedulers[renderer]
  const tip = useSyncExternalStore(scheduler.subscribe, scheduler.getSnapshot, () => null)
  const { id, startedAt, running, needsAttention } = props.turn ?? {}
  useEffect(() => {
    scheduler.update(id !== undefined && startedAt !== undefined ? { id, startedAt, running: Boolean(running), needsAttention: Boolean(needsAttention) } : undefined, props.visible && !props.signal.aborted && !disabled.has('tips'), tips)
  }, [scheduler, id, startedAt, running, needsAttention, props.visible, props.signal, tips, disabled])
  useEffect(() => {
    const cancel = () => scheduler.cancel()
    props.signal.addEventListener('abort', cancel)
    return () => { props.signal.removeEventListener('abort', cancel); cancel() }
  }, [scheduler, props.signal])
  const visibleTip = tip?.turnId === props.turn?.id && props.visible && props.turn?.running && !props.turn.needsAttention && !props.signal.aborted && !disabled.has('tips') && tips.some(entry => entry.id === tip?.id) ? tip : null
  useEffect(() => { props.report({ rows: visibleTip ? 1 : 0 }) }, [props.report, visibleTip])
  return visibleTip
}
