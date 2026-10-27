/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import { fitText } from '../../textLayout'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type ComposerDraftSnapshot } from '../types'
import { composerSnapshotText, attachmentCountLabel, compactComposerEntryText, composerEntryLineCount } from '../composerInput'

export type RenderComposerSlashPanelContext = {
  composerActive: boolean
  composerSlashOpen: boolean
  composerSlashVisibleCount: number
  composerMention: { start: number; query: string; } | null
  composerSlashCommands: SlashCommandSuggestion[]
  composerSlashIndex: number
  theme: TuiThemePalette
  composerAccentColor: string
  composerConfig: ProviderComposerConfig
}

export function runRenderComposerSlashPanel(ctx: RenderComposerSlashPanelContext, panelWidth: number, rowWidth: number) {
  const {
    composerActive, composerSlashOpen, composerSlashVisibleCount, composerMention,
    composerSlashCommands, composerSlashIndex, theme, composerAccentColor, composerConfig,
  } = ctx
  if (!composerActive || !composerSlashOpen || composerSlashVisibleCount <= 0 || composerMention) return null
  const hasHint = composerSlashCommands.some((entry) => Boolean(entry.argumentHint))
  const commandRatio = hasHint ? 0.45 : 0.3
  const commandCap = hasHint ? 36 : 22
  const commandWidth = Math.max(Math.min(commandCap, Math.floor(rowWidth * commandRatio)), 8)
  const descWidth = Math.max(rowWidth - commandWidth - 4, 4)
  const total = composerSlashCommands.length
  const start = Math.max(0, Math.min(composerSlashIndex - Math.floor((composerSlashVisibleCount - 1) / 2), total - composerSlashVisibleCount))
  const end = Math.min(total, start + composerSlashVisibleCount)
  const hasMoreBelow = end < total
  const hasMoreAbove = start > 0
  return (
    <box
      width={panelWidth}
      height={composerSlashVisibleCount + 3}
      paddingX={1}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={theme.border2}
      flexDirection="column"
    >
      <text fg={composerAccentColor} wrapMode="none">
        {fitText(`${composerConfig.label} commands · ↑↓ select · tab insert · esc cancel  (${composerSlashIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
      </text>
      {composerSlashCommands.slice(start, end).map((entry, offset) => {
        const index = start + offset
        const active = index === composerSlashIndex
        const commandText = entry.argumentHint
          ? fitText(`${entry.command} ${entry.argumentHint}`, commandWidth)
          : fitText(entry.command, commandWidth)
        return (
          <box key={entry.command} flexDirection="row" height={1} width={rowWidth}>
            <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
            <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{commandText}</text>
            <text fg={theme.dim} wrapMode="none">  </text>
            <text fg={theme.dim} wrapMode="none">{fitText(entry.description, descWidth)}</text>
          </box>
        )
      })}
    </box>
  )
}

export type RenderComposerHistoryPanelContext = {
  composerActive: boolean
  composerHistoryOpen: boolean
  composerHistoryVisibleCount: number
  composerMention: { start: number; query: string; } | null
  sentHistory: ComposerDraftSnapshot[]
  composerHistoryIndex: number
  theme: TuiThemePalette
  composerAccentColor: string
}

export function runRenderComposerHistoryPanel(ctx: RenderComposerHistoryPanelContext, panelWidth: number, rowWidth: number) {
  const {
    composerActive, composerHistoryOpen, composerHistoryVisibleCount, composerMention, sentHistory,
    composerHistoryIndex, theme, composerAccentColor,
  } = ctx
  if (!composerActive || !composerHistoryOpen || composerHistoryVisibleCount <= 0 || composerMention) return null
  const total = sentHistory.length
  const start = Math.max(0, Math.min(composerHistoryIndex - Math.floor((composerHistoryVisibleCount - 1) / 2), total - composerHistoryVisibleCount))
  const end = Math.min(total, start + composerHistoryVisibleCount)
  const hasMoreBelow = end < total
  const hasMoreAbove = start > 0
  const metaWidth = Math.max(Math.min(22, Math.floor(rowWidth * 0.28)), 10)
  const textWidth = Math.max(rowWidth - metaWidth - 4, 8)
  return (
    <box
      width={panelWidth}
      height={composerHistoryVisibleCount + 3}
      paddingX={1}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={theme.border2}
      flexDirection="column"
    >
      <text fg={composerAccentColor} wrapMode="none">
        {fitText(`history · ⌃P older · ⌃N newer · tab/enter use · esc cancel  (${composerHistoryIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
      </text>
      {sentHistory.slice().reverse().slice(start, end).map((entry, offset) => {
        const index = start + offset
        const active = index === composerHistoryIndex
        const text = composerSnapshotText(entry)
        const compact = compactComposerEntryText(text)
        const lineCount = composerEntryLineCount(text)
        const attachmentLabel = attachmentCountLabel(entry.attachments)
        const meta = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${text.length} chars${attachmentLabel ? ` · ${attachmentLabel}` : ''}`
        return (
          <box key={`history:${total - 1 - index}:${text.length}:${offset}`} flexDirection="row" height={1} width={rowWidth}>
            <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
            <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compact, textWidth)}</text>
            <text fg={theme.dim} wrapMode="none">  </text>
            <text fg={theme.dim} wrapMode="none">{fitText(meta, metaWidth)}</text>
          </box>
        )
      })}
    </box>
  )
}
