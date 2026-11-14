/** @jsxImportSource @opentui/react */
import { useRef, type ComponentType } from 'react'
import type { TextareaRenderable } from '@opentui/core'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { PluginComposerModule } from '../../../lib/plugins/composer'
import type { TuiComposerAccessoryProps } from '../../../tui/opentui/shell/sdk'
import { fitText } from '../../../tui/opentui/shell/sdk'
import { BETTER_STAGES, betterElapsed, recentBetterTools } from '../../../lib/plugins/betterProgress'
import { researchBetterPrompt } from '../../../tui/opentui/shell/sdkBetter'
import { useBetterPrompt } from '../useBetterPrompt'
export function BetterAccessory(props: TuiComposerAccessoryProps) {
  const state = useBetterPrompt(props, researchBetterPrompt), editor = useRef<TextareaRenderable | null>(null)
  const { theme } = props, progress = state.progress
  if (!props.visible) return null
  const width = Math.max(20, Math.min(props.viewportWidth - 4, 94)), height = Math.max(8, Math.min(props.height - 4, 18))
  const toolCount = progress ? `${progress.total} tools${progress.failed ? ` · ${progress.failed} failed` : ''}` : ''
  const recent = progress ? recentBetterTools(progress, Math.max(0, props.width - toolCount.length - 3)) : ''
  const suffix = progress ? `${betterElapsed(progress.startedAt, state.now)} · ${props.width < 55 ? 'Esc' : 'escape cancels'}` : ''
  return <>
    {(state.busy || state.notice || state.error) && <box height={state.busy || state.notice?.startsWith('The improved prompt') ? 2 : 1} marginLeft={props.marginLeft} width={props.width} flexDirection="column">
      {state.busy && progress ? <>
        <box height={1} flexDirection="row">
          <text>{Array.from({ length: 6 }, (_, i) => <span key={i} fg={i === progress.stage && Math.floor(state.now / 500) % 2 ? theme.dim : theme.cyan}>{i <= progress.stage ? '▰' : '▱'}</span>)}</text>
          <text fg={theme.text} wrapMode="none">{`  ${fitText(BETTER_STAGES[progress.stage], Math.max(0, props.width - suffix.length - 10))}  ${suffix}`}</text>
        </box>
        <text fg={progress.failed ? theme.amber : theme.muted} wrapMode="none">{`${fitText(recent, Math.max(0, props.width - toolCount.length - 3))}   ${toolCount}`}</text>
      </> : state.notice?.startsWith('The improved prompt') ? <>
        <box height={1} flexDirection="row" gap={2}>
          <text fg={theme.cyan} wrapMode="none">{fitText('The improved prompt is in your input box.', Math.max(0, props.width - 13))}</text>
          <text fg={theme.dim} onMouseDown={state.dismiss}>[× dismiss]</text>
        </box>
        <text fg={theme.muted} wrapMode="none">{fitText(state.notice.slice('The improved prompt is in your input box. '.length), props.width)}</text>
      </> : <box height={1} flexDirection="row" gap={2}>
        <text fg={state.error ? theme.red : theme.cyan} wrapMode="none">{fitText(state.error ?? state.notice ?? '', Math.max(0, props.width - 13))}</text>
        <text fg={theme.dim} onMouseDown={state.dismiss}>[× dismiss]</text>
      </box>}
    </box>}
    {state.open && <box position="absolute" top={Math.max(0, Math.floor((props.height - height) / 2))} left={Math.max(0, Math.floor((props.viewportWidth - width) / 2))}
      width={width} height={height} border borderColor={theme.cyan} backgroundColor={theme.surface} zIndex={props.modalZIndex} title=" Better prompt " flexDirection="column" paddingX={1}>
      <text fg={theme.muted}>Research only · the rewrite returns to your composer</text>
      <box flexGrow={1} marginY={1} backgroundColor={theme.surface3}>
        <textarea initialValue={state.input} focused width="100%" height="100%" ref={editor} onContentChange={() => state.setInput(editor.current?.plainText ?? '')} />
      </box>
      <text fg={theme.dim}>Ctrl+Enter research and rewrite · Esc cancel</text>
      <text fg={theme.cyan} onMouseDown={() => void state.generate()}>[ Research and rewrite ]</text>
    </box>}
  </>
}
export const composer: PluginComposerModule<ComponentType<TuiComposerAccessoryProps>> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'better', accessories: { 'better-prompt': BetterAccessory } }
