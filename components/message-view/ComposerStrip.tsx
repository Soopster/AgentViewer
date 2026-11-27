'use client'
// The composer's status strip: provider chip, model, context, cost, effort and
// folder, shaped by the shown view (the git cluster beside it is the composer's).
import { Fragment } from 'react'
import { orderStripGroups, shapeStripSegments, stripFolderLabel, stripSeparatorText, type ComposerStripPart, type ComposerStripSpec } from '@/lib/composerStrip'
import { fmtCost } from '@/lib/analytics'
import { pathBasename } from '@/lib/projectPaths'
import { BUILTIN_VIEW_SPECS, type ViewSpec } from '@/tui/viewSpec'
import type { ContextUsage } from '@/lib/types'
import { useWebViewStyle } from './webViewStyle'

type Entry = { text: string; fg: string; part: ComposerStripPart; urgent?: boolean; percent?: number; title?: string }

export function useComposerStripSpec(): ComposerStripSpec & Pick<ViewSpec, 'stripHints' | 'stripBadge' | 'stripSeparator' | 'stripOrder' | 'stripFolderStyle'> {
  return { ...BUILTIN_VIEW_SPECS.conversation, ...useWebViewStyle() }
}

export function ComposerStrip({ label, accent, model, effort, contextUsage, costUsd, cwd }: {
  label: string
  /** CSS colour of the provider. */
  accent: string
  model: string | null
  effort: string
  contextUsage: ContextUsage | null
  costUsd: number | null
  cwd: string | null | undefined
}) {
  const spec = useComposerStripSpec()
  const percentage = contextUsage && Number.isFinite(contextUsage.percentage) ? Math.round(contextUsage.percentage) : null
  const entries: Entry[] = [{ text: `model:${!model || model === 'default' ? 'auto' : model}`, fg: accent, part: 'model' }]
  if (percentage !== null) entries.push({ text: `ctx:${percentage}%`, fg: percentage >= 80 ? 'var(--red)' : percentage >= 60 ? 'var(--amber)' : 'var(--green)', part: 'context', urgent: percentage >= 60, percent: percentage })
  if (costUsd !== null && costUsd >= 0.005) entries.push({ text: `cost:~${fmtCost(costUsd)}`, fg: 'var(--text-3)', part: 'cost', title: 'Estimate at list price' })
  entries.push({ text: `effort:${effort}`, fg: 'var(--text-3)', part: 'effort' })
  if (cwd) entries.push({ text: stripFolderLabel(cwd, spec.stripFolderStyle, pathBasename(cwd)), fg: 'var(--text-3)', part: 'folder', title: cwd })
  const shaped = shapeStripSegments(entries, spec, { muted: 'var(--text-3)', accent, bright: 'var(--text)' })
  const [first, location, last] = orderStripGroups(spec.stripOrder, shaped.filter((entry) => entry.part !== 'folder'), shaped.filter((entry) => entry.part === 'folder'))
  const separator = stripSeparatorText(spec.stripSeparator)
  return (
    <span className="av-web-composer-strip" data-testid="composer-strip">
      {spec.stripBadge === 'off' ? null : (
        <span className="av-web-composer-badge" style={spec.stripBadge === 'filled' ? { background: accent, color: 'var(--surface)' } : { color: accent }}>
          {spec.stripBadge === 'brackets' ? `[${label.toUpperCase()}]` : spec.stripBadge === 'dot' ? `● ${label.toUpperCase()}` : label.toUpperCase()}
        </span>
      )}
      {[...first, ...location, ...last].map((entry, index) => (
        <Fragment key={entry.part}>
          {index > 0 || spec.stripBadge !== 'off' ? <span className="av-web-composer-strip-sep" aria-hidden>{separator}</span> : null}
          <span style={{ color: entry.fg }} title={entry.title}>{entry.text}</span>
        </Fragment>
      ))}
    </span>
  )
}
