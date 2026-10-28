/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import { fitText } from '../../textLayout'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type ComposerDraftSnapshot } from '../types'
import { composerSnapshotText, attachmentCountLabel, compactComposerEntryText, composerEntryLineCount } from '../composerInput'
import { basename, join } from 'node:path'
import { type TuiMentionResult } from '../types'
import { type QueuedComposerSend } from '../types'
import { type RewindCandidate } from '../../rewindTargets'
import React, { type RefObject } from 'react'
import { type SyntaxStyle, type TextareaRenderable } from '@opentui/core'
import { COMPOSER_SHELL_CURSOR, COMPOSER_PROMPT_CURSOR } from '../layoutConstants'
import { composerKeyBindings } from '../composerInput'

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

export type RenderComposerStashPanelContext = {
  composerActive: boolean
  composerStashOpen: boolean
  composerStashVisibleCount: number
  composerMention: { start: number; query: string; } | null
  composerStash: ComposerDraftSnapshot[]
  composerStashIndex: number
  theme: TuiThemePalette
  composerAccentColor: string
}

export function runRenderComposerStashPanel(ctx: RenderComposerStashPanelContext, panelWidth: number, rowWidth: number) {
  const {
    composerActive, composerStashOpen, composerStashVisibleCount, composerMention, composerStash,
    composerStashIndex, theme, composerAccentColor,
  } = ctx
  if (!composerActive || !composerStashOpen || composerStashVisibleCount <= 0 || composerMention) return null
  const total = composerStash.length
  const start = Math.max(0, Math.min(composerStashIndex - Math.floor((composerStashVisibleCount - 1) / 2), total - composerStashVisibleCount))
  const end = Math.min(total, start + composerStashVisibleCount)
  const hasMoreBelow = end < total
  const hasMoreAbove = start > 0
  const metaWidth = Math.max(Math.min(22, Math.floor(rowWidth * 0.28)), 10)
  const textWidth = Math.max(rowWidth - metaWidth - 4, 8)
  return (
    <box
      width={panelWidth}
      height={composerStashVisibleCount + 3}
      paddingX={1}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={theme.border2}
      flexDirection="column"
    >
      <text fg={composerAccentColor} wrapMode="none">
        {fitText(`stash · ⌃P older · ⌃N newer · tab/enter restore · esc close  (${composerStashIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
      </text>
      {composerStash.slice().reverse().slice(start, end).map((entry, offset) => {
        const index = start + offset
        const active = index === composerStashIndex
        const text = composerSnapshotText(entry)
        const compact = compactComposerEntryText(text)
        const lineCount = composerEntryLineCount(text)
        const attachmentLabel = attachmentCountLabel(entry.attachments)
        const meta = `${lineCount} line${lineCount === 1 ? '' : 's'} · ${text.length} chars${attachmentLabel ? ` · ${attachmentLabel}` : ''}`
        return (
          <box key={`stash:${total - 1 - index}:${text.length}:${offset}`} flexDirection="row" height={1} width={rowWidth}>
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

export type RenderComposerMentionPanelContext = {
  composerActive: boolean
  composerMention: { start: number; query: string; } | null
  composerMentionVisibleCount: number
  composerMentionResults: TuiMentionResult[]
  composerMentionIndex: number
  theme: TuiThemePalette
  composerAccentColor: string
  composerConfig: ProviderComposerConfig
  composerProvider: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
}

export function runRenderComposerMentionPanel(ctx: RenderComposerMentionPanelContext, panelWidth: number, rowWidth: number) {
  const {
    composerActive, composerMention, composerMentionVisibleCount, composerMentionResults,
    composerMentionIndex, theme, composerAccentColor, composerConfig, composerProvider,
  } = ctx
  if (!composerActive || !composerMention || composerMentionVisibleCount <= 0) return null
  const basenameWidth = Math.max(Math.min(28, Math.floor(rowWidth * 0.4)), 8)
  const pathWidth = Math.max(rowWidth - basenameWidth - 4, 4)
  const total = composerMentionResults.length
  const start = Math.max(0, Math.min(composerMentionIndex - Math.floor((composerMentionVisibleCount - 1) / 2), total - composerMentionVisibleCount))
  const end = Math.min(total, start + composerMentionVisibleCount)
  const hasMoreBelow = end < total
  const hasMoreAbove = start > 0
  return (
    <box
      width={panelWidth}
      height={composerMentionVisibleCount + 3}
      paddingX={1}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={theme.border2}
      flexDirection="column"
    >
      <text fg={composerAccentColor} wrapMode="none">
        {fitText(`${composerConfig.label} ${composerProvider === 'opencode' ? 'files/agents' : 'files'} · ↑↓ select · tab insert · esc cancel  (${composerMentionIndex + 1}/${total})${hasMoreAbove ? ' ↑' : ''}${hasMoreBelow ? ' ↓' : ''}`, rowWidth)}
      </text>
      {composerMentionResults.slice(start, end).map((entry, offset) => {
        const index = start + offset
        const active = index === composerMentionIndex
        const label = entry.kind === 'agent' ? `@${entry.name}` : entry.basename
        const detail = entry.kind === 'agent'
          ? [entry.mode, entry.description].filter(Boolean).join(' · ')
          : entry.path
        return (
          <box key={entry.kind === 'agent' ? `agent:${entry.name}` : `file:${entry.path}`} flexDirection="row" height={1} width={rowWidth}>
            <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
            <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(label, basenameWidth)}</text>
            <text fg={theme.dim} wrapMode="none">  </text>
            <text fg={theme.dim} wrapMode="none">{fitText(detail, pathWidth)}</text>
          </box>
        )
      })}
    </box>
  )
}

export type RenderComposerQueuePanelContext = {
  composerActive: boolean
  activeQueuedComposerSends: QueuedComposerSend[]
  theme: TuiThemePalette
  composerQueueDurable: boolean
  composerAccentColor: string
}

export function runRenderComposerQueuePanel(ctx: RenderComposerQueuePanelContext, panelWidth: number, rowWidth: number) {
  const {
    composerActive, activeQueuedComposerSends, theme, composerQueueDurable, composerAccentColor,
  } = ctx
  if (!composerActive || activeQueuedComposerSends.length === 0) return null
  const visible = Math.min(activeQueuedComposerSends.length, 4)
  const hiddenCount = activeQueuedComposerSends.length - visible
  return (
    <box
      width={panelWidth}
      height={visible + (hiddenCount > 0 ? 2 : 1) + 2}
      paddingX={1}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={composerQueueDurable ? (theme.amber ?? theme.border2) : theme.red}
      flexDirection="column"
    >
      <text fg={composerQueueDurable ? (theme.amber ?? composerAccentColor) : theme.red} wrapMode="none">
        {fitText(`${composerQueueDurable ? '' : 'memory only · '}queued (${activeQueuedComposerSends.length}) · sends in order after this turn · ⌃Y edit newest · ⇧⌃Y clear`, rowWidth)}
      </text>
      {activeQueuedComposerSends.slice(0, visible).map((entry, index) => {
        const compact = compactComposerEntryText(entry.text)
        const attachmentLabel = attachmentCountLabel(entry.attachments)
        const suffix = attachmentLabel ? `  ${attachmentLabel}` : ''
        return (
          <box key={entry.id} flexDirection="row" height={1} width={rowWidth}>
            <text fg={theme.dim} wrapMode="none">{`${index + 1}. `}</text>
            <text fg={theme.text} wrapMode="none">{fitText(compact, Math.max(rowWidth - 6 - suffix.length, 8))}</text>
            <text fg={theme.dim} wrapMode="none">{suffix}</text>
          </box>
        )
      })}
      {hiddenCount > 0 ? (
        <text fg={theme.dim} wrapMode="none">{fitText(`  +${hiddenCount} more queued`, rowWidth)}</text>
      ) : null}
    </box>
  )
}

export type RenderComposerRewindPanelContext = {
  composerActive: boolean
  composerRewindItems: RewindCandidate[] | null
  composerRewindVisibleCount: number
  composerRewindIndex: number
  theme: TuiThemePalette
  composerAccentColor: string
}

export function runRenderComposerRewindPanel(ctx: RenderComposerRewindPanelContext, panelWidth: number, rowWidth: number) {
  const {
    composerActive, composerRewindItems, composerRewindVisibleCount, composerRewindIndex, theme,
    composerAccentColor,
  } = ctx
  if (!composerActive || !composerRewindItems || composerRewindVisibleCount <= 0) return null
  const total = composerRewindItems.length
  const start = Math.max(0, Math.min(composerRewindIndex - Math.floor((composerRewindVisibleCount - 1) / 2), total - composerRewindVisibleCount))
  const end = Math.min(total, start + composerRewindVisibleCount)
  return (
    <box
      width={panelWidth}
      height={composerRewindVisibleCount + 3}
      paddingX={1}
      backgroundColor={theme.surface2}
      border
      borderStyle="single"
      borderColor={theme.border2}
      flexDirection="column"
    >
      <text fg={composerAccentColor} wrapMode="none">
        {fitText(`rewind to before · ↑↓ choose · enter rewind · tab rewind + files · esc cancel  (${composerRewindIndex + 1}/${total})${start > 0 ? ' ↑' : ''}${end < total ? ' ↓' : ''}`, rowWidth)}
      </text>
      {composerRewindItems.slice(start, end).map((entry, offset) => {
        const active = start + offset === composerRewindIndex
        return (
          <box key={`rewind:${entry.uuid}`} flexDirection="row" height={1} width={rowWidth}>
            <text fg={active ? composerAccentColor : theme.dim} wrapMode="none">{active ? '▸ ' : '  '}</text>
            <text fg={active ? composerAccentColor : theme.text} wrapMode="none">{fitText(compactComposerEntryText(entry.text), Math.max(rowWidth - 2, 8))}</text>
          </box>
        )
      })}
    </box>
  )
}

export type RenderComposerTextareaContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerActive: boolean
  windowControlMode: 'identify' | 'manage' | null
  composerPlaceholder: string
  composerDraft: string
  composerSyntaxStyle: SyntaxStyle
  composerShellDraft: boolean
  theme: TuiThemePalette
  handleComposerContentChange: () => void
  composerChatTextareaStyle: { backgroundColor: string; focusedBackgroundColor: string; flexGrow: number; textColor: string; focusedTextColor: string; placeholderColor: string; }
  composerBaseTextareaStyle: { backgroundColor: string; textColor: string; focusedBackgroundColor: string; focusedTextColor: string; placeholderColor: string; }
  composerDockTextareaStyle: { backgroundColor: string; focusedBackgroundColor: string; flexGrow: number; textColor: string; focusedTextColor: string; placeholderColor: string; }
}

export function runRenderComposerTextarea(ctx: RenderComposerTextareaContext, onSubmit: () => void, options?: { height?: number; width?: number; variant?: 'chat'; background?: string }) {
  const {
    composerTextareaRef, composerActive, windowControlMode, composerPlaceholder, composerDraft,
    composerSyntaxStyle, composerShellDraft, theme, handleComposerContentChange,
    composerChatTextareaStyle, composerBaseTextareaStyle, composerDockTextareaStyle,
  } = ctx
return (
  <textarea
    id="composer-textarea"
    ref={composerTextareaRef}
    focused={composerActive && !windowControlMode}
    width={options?.width}
    height={options?.height}
    wrapMode="word"
    placeholder={composerPlaceholder}
    initialValue={composerDraft}
    keyBindings={composerKeyBindings}
    syntaxStyle={composerSyntaxStyle}
    // The default cursor is white whatever the theme, which is no cursor at
    // all on a light one.
    cursorColor={composerShellDraft ? theme.amber : theme.text}
    cursorStyle={composerShellDraft ? COMPOSER_SHELL_CURSOR : COMPOSER_PROMPT_CURSOR}
    onContentChange={handleComposerContentChange}
    onSubmit={onSubmit}
    style={options?.variant === 'chat'
      ? composerChatTextareaStyle
      : options?.background
      ? { ...composerBaseTextareaStyle, backgroundColor: options.background, focusedBackgroundColor: options.background }
      : options?.height ? composerBaseTextareaStyle : composerDockTextareaStyle}
  />
)
}
