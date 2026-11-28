'use client'
// The skills added to the prompt, as removable chips above the composer.
import { useEffect, useSyncExternalStore, type ComponentType } from 'react'
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { ComposerAccessoryProps, PluginComposerModule } from '../../../lib/plugins/composer'
import { draftWithoutSkill, removeSkillChip, skillChipsFor, subscribeSkillChips, visibleSkillChips } from '../chips'

function SkillChips(props: ComposerAccessoryProps) {
  const sessionId = props.session.sessionId
  const all = useSyncExternalStore(subscribeSkillChips, () => skillChipsFor(sessionId), () => skillChipsFor(sessionId))
  const chips = visibleSkillChips(all, props.draft)
  const { report } = props
  const summary = chips.length ? chips.map(chip => chip.name).join(', ') : null
  useEffect(() => report({ rows: summary ? 1 : 0, summary }), [report, summary])
  if (!chips.length || !props.visible) return null
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1 text-xs" aria-label="Skills in this prompt">
      {chips.map(chip => (
        <span key={chip.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5">
          <span aria-hidden>✦</span>
          <span>{chip.name}</span>
          <button type="button" aria-label={`Remove ${chip.name}`} disabled={props.disabled} className="text-muted-foreground hover:text-foreground"
            onClick={() => { removeSkillChip(sessionId, chip.id); props.services.composer?.stageDraft?.(draftWithoutSkill(props.draft, chip.text), props.draft) }}>×</button>
        </span>
      ))}
    </div>
  )
}

export const composer: PluginComposerModule<ComponentType<ComposerAccessoryProps>> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'skill-picker',
  accessories: { 'skill-chips': SkillChips },
}
