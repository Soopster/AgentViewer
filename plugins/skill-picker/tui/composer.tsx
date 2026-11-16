/** @jsxImportSource @opentui/react */
// The skills added to the prompt, as one row of chips above the composer. Loaded when a composer
// mounts, so it stays free of the picker's own imports.
import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { PluginComposerModule } from '../../../lib/plugins/composer'
import { fitText, type TuiComposerAccessoryProps } from '../../../tui/opentui/shell/sdk'
import { draftWithoutSkill, removeSkillChip, skillChipsFor, subscribeSkillChips, visibleSkillChips } from '../chips'

function SkillChips(props: TuiComposerAccessoryProps) {
  const sessionId = props.session.sessionId
  const all = useSyncExternalStore(subscribeSkillChips, () => skillChipsFor(sessionId))
  const chips = visibleSkillChips(all, props.draft)
  const { report } = props
  const summary = chips.length ? chips.map(chip => chip.name).join(', ') : null
  useEffect(() => report({ rows: summary ? 1 : 0, summary }), [report, summary])
  if (!chips.length || !props.visible) return null
  const remove = (id: string, text: string) => {
    removeSkillChip(sessionId, id)
    props.services.composer?.stageDraft?.(draftWithoutSkill(props.draft, text), props.draft)
  }
  const room = Math.max(props.width - 4, 8)
  const label = (name: string) => ` ✦ ${fitText(name, Math.max(Math.floor(room / chips.length) - 6, 6))} `
  return (
    <box height={1} flexShrink={0} marginLeft={props.marginLeft} width={props.width} backgroundColor={props.theme.surface2} paddingX={1} flexDirection="row" overflow="hidden">
      {chips.map(chip => (
        <box key={chip.id} flexDirection="row" marginRight={1} onMouseDown={() => remove(chip.id, chip.text)}>
          <text fg={props.theme.amber} wrapMode="none">{label(chip.name)}</text>
          <text fg={props.theme.dim} wrapMode="none">{'× '}</text>
        </box>
      ))}
    </box>
  )
}

export const composer: PluginComposerModule<ComponentType<TuiComposerAccessoryProps>> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'skill-picker',
  accessories: { 'skill-chips': SkillChips },
}
