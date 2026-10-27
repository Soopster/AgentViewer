/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import { fitText } from '../../textLayout'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'

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
