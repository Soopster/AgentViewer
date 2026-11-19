/** @jsxImportSource @opentui/react */
import { useMemo } from 'react'
import type { TuiTranscriptCard } from '../../format'
import type { TuiThemePalette } from '../../theme'
import { WindowButton } from '../WindowButton'
import { fitText } from '../textLayout'
import { stickyPromptText } from './transcriptRows'

const CONTROL_WIDTHS = [17, 13, 8]
export function promptNavigationRows(width: number): number {
  if (width >= 80) return 1
  let rows = 1, used = 0
  for (const cells of CONTROL_WIDTHS) {
    if (used && used + cells > width) { rows++; used = 0 }
    used += cells
  }
  return rows + 1
}

/** Prompt identity, rather than its text, preserves repeated identical requests. */
export function promptNavigationState(cards: readonly TuiTranscriptCard[], currentKey: string | null, following: boolean) {
  const prompts: TuiTranscriptCard[] = []
  const at = following ? cards.length - 1 : Math.max(0, cards.findIndex(card => card.key === currentKey))
  let current = 0
  cards.forEach((card, index) => {
    if (card.role !== 'user') return
    prompts.push(card)
    if (index <= at) current = prompts.length - 1
  })
  return { prompts, current }
}

/** Copied table rows should read as a request rather than Markdown scaffolding. */
export function promptNavigationPreview(card: TuiTranscriptCard): string {
  const lines = card.lines.flatMap(line => line.text.split('\n')).filter(line => !/^\s*\[(?:local )?image\](?:\s|$)/i.test(line))
  const separator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/
  const plain = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!lines.some(line => separator.test(line))) return plain || 'Image attachment'
  return lines.filter(line => !separator.test(line)).map(line => {
    if (!line.trim().startsWith('|') && !/^[^|]*\|(?:\s*\|)+\s*$/.test(line)) return line.trim()
    return line.split('|').map(cell => cell.trim()).filter(Boolean).join(' · ')
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || stickyPromptText(card)
}

export function PromptNavigation({ cards, currentKey, following, width, theme, onJump, onLatest }: {
  cards: readonly TuiTranscriptCard[]; currentKey: string | null; following: boolean
  width: number; theme: TuiThemePalette; onJump: (key: string) => void; onLatest: () => void
}) {
  const { prompts, current } = useMemo(() => promptNavigationState(cards, currentKey, following), [cards, currentKey, following])
  const rows = promptNavigationRows(width)
  const stacked = rows > 1
  const prompt = prompts[current]
  const label = prompt ? `Turn ${current + 1}/${prompts.length} · ${promptNavigationPreview(prompt)}` : 'No prompts'
  const controls = [
    { id: 'previous-prompt', label: ' Previous prompt ', enabled: current > 0, action: () => onJump(prompts[current - 1]!.key) },
    { id: 'next-prompt', label: ' Next prompt ', enabled: current < prompts.length - 1, action: () => onJump(prompts[current + 1]!.key) },
    { id: 'latest', label: ' Latest ', enabled: true, action: onLatest },
  ]
  return <box id="prompt-navigation" height={rows} flexShrink={0} paddingX={1} flexDirection={stacked ? 'column' : 'row'} backgroundColor={theme.surface2}>
    <text fg={theme.text} width={Math.max(1, stacked ? width : width - 41)} height={1} wrapMode="none">{fitText(label, Math.max(1, stacked ? width : width - 41))}</text>
    {!stacked ? <text fg={theme.dim} width={3} height={1} wrapMode="none">{' │ '}</text> : null}
    <box height={stacked ? rows - 1 : 1} width={stacked ? width : 38} flexDirection="row" flexWrap="wrap" flexShrink={0}>
      {controls.map(control => control.enabled
        ? <WindowButton key={control.id} id={`prompt-navigation:${control.id}`} label={control.label} theme={theme} foreground={theme.cyan} background={theme.surface2} onPress={control.action} />
        : <text key={control.id} fg={theme.dim} wrapMode="none">{control.label}</text>)}
    </box>
  </box>
}
