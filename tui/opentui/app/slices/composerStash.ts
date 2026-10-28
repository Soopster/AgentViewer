import type { ComposerSessions } from '../../../../lib/composerSessions'
/** @jsxImportSource @opentui/react */
import { useComposerSessionState } from '../../../../lib/composerSessions'
import React, { useMemo, useRef, useState } from 'react'
import { useStableEvent } from '../../useStableEvent'
import { defaultPermissionOptionIndex, type PendingPermission, type PermissionOption } from '../../../../lib/permissions'
import { useComposerListState } from '../state/composerListState'

export type UseComposerStashGroupContext = {
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function useComposerStashGroup(ctx: UseComposerStashGroupContext) {
  const {
    composerSessions, composerOwnerKey,
  } = ctx

  const {
    composerStash, setComposerStash, composerStashOpen, setComposerStashOpen, composerRewindItems,
    setComposerRewindItems, composerRewindIndex, setComposerRewindIndex, composerStashIndex,
    setComposerStashIndex, composerSlashIndex, setComposerSlashIndex, composerSlashDismissed,
    setComposerSlashDismissed, composerHistoryOpen, setComposerHistoryOpen, composerHistoryIndex,
    setComposerHistoryIndex, composerLiveSlashCommands, setComposerLiveSlashCommands,
    composerSendState, setComposerSendState, composerActivitySessionKey,
    setComposerActivitySessionKey, composerSendStartedAt, setComposerSendStartedAt,
    interruptPressActive, setInterruptPressActive, backgroundingTasks, setBackgroundingTasks,
  } = useComposerListState({
    composerSessions, composerOwnerKey,
  })
  const interruptPressTimeoutRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'interruptPressTimeoutRef', null)
  // Pending tool-approval requests surfaced from the live SSE stream (Claude
  // canUseTool, Copilot/OpenCode permission events, Codex approvals). The
  // overlay below the composer lets the user allow/reject them, matching native.
  const [nativePendingPermissions, setPendingPermissions] = useState<PendingPermission[]>([])
  const [asyncQuestionPrompt, setAsyncQuestionPrompt] = useState<PendingPermission | null>(null)
  const pendingPermissions = useMemo(() => asyncQuestionPrompt
    ? [...nativePendingPermissions, asyncQuestionPrompt] : nativePendingPermissions,
  [nativePendingPermissions, asyncQuestionPrompt])
  const [permissionActionLoading, setPermissionActionLoading] = useState<string | null>(null)
  const [permissionOptionIndex, setPermissionOptionIndex] = useState(0)
  // Which permission `permissionOptionIndex` was last moved for. The index is
  // reset to 0 from several places (a turn starting, an answer landing, an
  // interrupt); that is the wrong opening cursor for a `defaultToDeny` ask, and
  // chasing every reset site would leave the next one to get it wrong. Reading
  // the owner instead means an index only counts as the user's choice while the
  // card it was made on is still the one on screen.
  const permissionOptionOwnerRef = useRef<string | null>(null)
  const resolvePermissionOptionIndex = useStableEvent((permission: PendingPermission, options: PermissionOption[]): number => {
    if (permissionOptionOwnerRef.current !== permission.id) return defaultPermissionOptionIndex(permission, options)
    return Math.min(permissionOptionIndex, options.length - 1)
  })
  const movePermissionOptionIndex = useStableEvent((permission: PendingPermission, options: PermissionOption[], delta: number) => {
    const from = resolvePermissionOptionIndex(permission, options)
    permissionOptionOwnerRef.current = permission.id
    setPermissionOptionIndex(Math.max(0, Math.min(options.length - 1, from + delta)))
  })
  // A turn is running for the selected session that this composer does not own
  // a stream for — the send stream died but the turn survived (turns are
  // decoupled from their stream), or a turn from another view is still
  // finishing. Detected by polling the in-process running registry while idle;
  // mirrors the web composer's reattach flow.
  const [reattachedRunning, setReattachedRunning] = useComposerSessionState(composerSessions, composerOwnerKey, 'reattachedRunning', false)
  const reattachedRunningRef = composerSessions.ref(composerOwnerKey, 'reattachedRunningRef', false)

  return {
    composerStash, setComposerStash, composerStashOpen, setComposerStashOpen, composerRewindItems,
    setComposerRewindItems, composerRewindIndex, setComposerRewindIndex, composerStashIndex,
    setComposerStashIndex, composerSlashIndex, setComposerSlashIndex, composerSlashDismissed,
    setComposerSlashDismissed, composerHistoryOpen, setComposerHistoryOpen, composerHistoryIndex,
    setComposerHistoryIndex, composerLiveSlashCommands, setComposerLiveSlashCommands,
    composerSendState, setComposerSendState, composerActivitySessionKey,
    setComposerActivitySessionKey, composerSendStartedAt, setComposerSendStartedAt,
    interruptPressActive, setInterruptPressActive, backgroundingTasks, setBackgroundingTasks,
    interruptPressTimeoutRef, setPendingPermissions, setAsyncQuestionPrompt, pendingPermissions,
    permissionActionLoading, setPermissionActionLoading, permissionOptionIndex,
    setPermissionOptionIndex, resolvePermissionOptionIndex, movePermissionOptionIndex,
    reattachedRunning, setReattachedRunning, reattachedRunningRef,
  }
}
