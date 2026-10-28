import type { ReasoningEffortLevel, SendAttachment, Session } from './types'

export type ComposerDraftPayload = {
  message: string
  attachments?: SendAttachment[]
}

export type ComposerTurnOptions = {
  turnRequestId: string
  model?: string
  effort?: ReasoningEffortLevel
  agent?: string
  mode?: string
  contextTier?: string
  permissionMode?: string
  approvalPolicy?: string
  taskBudgetTokens?: number | null
  enableWorkflow?: boolean
}

/** Provider policy shared by HTTP and in-process submissions. UI-only options
 * (fork previews, directory pickers, collaboration mode) compose at the caller. */
export function prepareComposerTurnRequest(session: Session, draft: ComposerDraftPayload, options: ComposerTurnOptions) {
  const provider = session.provider
  return {
    ...draft,
    provider,
    model: options.model || undefined,
    effort: options.effort,
    agent: provider === 'opencode' && options.agent ? options.agent : undefined,
    mode: provider === 'copilot' ? options.mode : undefined,
    contextTier: provider === 'copilot' ? options.contextTier : undefined,
    permissionMode: provider === 'claude' || provider === 'copilot' ? options.permissionMode : undefined,
    approvalPolicy: provider === 'codex' && options.approvalPolicy !== 'auto' ? options.approvalPolicy : undefined,
    manualPermissions: provider === 'copilot'
      || (provider === 'claude' && options.permissionMode !== 'bypassPermissions' && options.permissionMode !== 'plan')
      ? true : undefined,
    nativeCommands: provider === 'copilot' ? true : undefined,
    taskBudgetTokens: options.taskBudgetTokens ?? undefined,
    enableWorkflow: provider === 'claude' && options.enableWorkflow ? true : undefined,
    isPendingSession: session.isPending === true ? true : undefined,
    cwd: session.cwd ?? undefined,
    detachOnClientAbort: true,
    turnRequestId: options.turnRequestId,
  }
}
