/** @jsxImportSource @opentui/react */
import type { ProviderComposerConfig } from '../../../../lib/providerComposer'
import { useMemo } from 'react'
import { formatSessionTitle } from '../../../format'
import { getProviderAccent } from '../../../theme'
import { type TuiProviderInstanceChoice } from '../../../../lib/tui/service'
import { type ProviderSelection, type SendAttachment, type Session } from '../../../../lib/types'
import { fitText, joinMeta } from '../../textLayout'
import { type ComposerPromptPart } from '../types'
import { attachmentCountLabel } from '../composerInput'
import { providerSelectOptions } from '../pickers'
import { currentProjectName } from '../viewHelpers'

export type UseStatusLabelGroupContext = {
  loadingSessions: boolean
  refreshingSessions: boolean
  followTail: boolean
  pendingNewCount: number
  selectedSession: Session | null
  readerModel: string | null
  rightPaneWidth: number
  providerInstances: TuiProviderInstanceChoice[]
  disabledPlugins: ReadonlySet<string>
  provider: ProviderSelection
  composerTargetSession: Session | null
  visibleComposerSending: boolean
  composerExample: string
  composerConfig: ProviderComposerConfig
  prepareComposerSubmission: (visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]) => { visibleText: string; messageText: string; attachments: SendAttachment[]; promptParts: ({ id: string; kind: 'text'; marker: string; text: string; } | { id: string; kind: 'attachment'; marker: string; attachment: SendAttachment; })[]; }
  composerDraft: string
  composerMentionAttachments: SendAttachment[]
  composerPromptParts: ComposerPromptPart[]
}

export function useStatusLabelGroup(ctx: UseStatusLabelGroupContext) {
  const {
    loadingSessions, refreshingSessions, followTail, pendingNewCount, selectedSession, readerModel,
    rightPaneWidth, providerInstances, disabledPlugins, provider, composerTargetSession,
    visibleComposerSending, composerExample, composerConfig, prepareComposerSubmission,
    composerDraft, composerMentionAttachments, composerPromptParts,
  } = ctx

  const statusLabel = loadingSessions ? 'syncing' : refreshingSessions ? 'refreshing' : 'live'
  const readerMode = followTail ? null : pendingNewCount > 0 ? 'new content' : 'reading'
  const readerContextMeta = useMemo(
    () => fitText(
      joinMeta([
        currentProjectName(selectedSession),
        readerModel,
      ]),
      Math.min(Math.max(Math.floor(rightPaneWidth * 0.28), 18), 42),
    ),
    [selectedSession, readerModel, rightPaneWidth],
  )
  const previewBarText = useMemo(
    () => selectedSession
      ? fitText(
          `${formatSessionTitle(selectedSession)}  ·  preview  ·  ↵ open  ·  tab focus`,
          Math.max(rightPaneWidth - 2, 16),
        )
      : '',
    [rightPaneWidth, selectedSession],
  )

  const providerOptions = useMemo(() => providerSelectOptions(providerInstances), [providerInstances, disabledPlugins])
  const providerAccent = getProviderAccent(provider)
  const composerPlaceholder = composerTargetSession
    ? (visibleComposerSending
        ? 'Follow-up…'
        : composerExample)
    : composerConfig.placeholderNoSession
  const composerActiveAttachments = useMemo(
    () => prepareComposerSubmission(composerDraft, composerMentionAttachments, composerPromptParts).attachments,
    [composerDraft, composerMentionAttachments, composerPromptParts, prepareComposerSubmission],
  )
  const composerAttachmentLabel = attachmentCountLabel(composerActiveAttachments)

  return {
    readerContextMeta, previewBarText, providerOptions, providerAccent, composerPlaceholder,
    composerAttachmentLabel,
  }
}
