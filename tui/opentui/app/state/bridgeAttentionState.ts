/** @jsxImportSource @opentui/react */
import { useEngineeringLocalState } from '../../engineering/state'
import { createComposerSessions } from '../../../../lib/composerSessions'
import { useRef, useState } from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type WorktreeTask } from '../../../../lib/tui/service'
import { type PlaybookSummary, type ProtocolAutonomy } from '../../../../lib/agentProtocol'
import { type AgentProvider } from '../../../../lib/types'
import { type PendingPermission } from '../../../../lib/permissions'
import { sessionKey } from '../sessionList'

export function useBridgeAttentionState() {
  const lastBridgeChatIdRef = useRef<string | undefined>(undefined)
  // Track bridge sent/reply entries for inline display in the transcript
  const [bridgeTranscriptEntries, setBridgeTranscriptEntries] = useState<
    Array<{ kind: 'sent' | 'reply'; text: string; timestamp: string }>
  >([])
  // Track which bridge entries we've persisted to disk
  const persistedBridgeCountRef = useRef(0)
  // Attention inbox — cross-session triage of prompts blocked on a human and
  // background turns that finished while the user was elsewhere.
  const [attentionOpen, setAttentionOpen] = useState(false)
  const attentionKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // Pending Claude prompts from running sessions OTHER than the selected one
  // (the selected session's prompts live in pendingPermissions). Fed by the
  // registry poll.
  const [backgroundPrompts, setBackgroundPrompts] = useState<PendingPermission[]>([])
  // Turns that finished on sessions the user wasn't viewing; dismissed by
  // opening the session, pressing x in the inbox, or falling off the cap.
  const [attentionDone, setAttentionDone] = useState<Array<{
    key: string
    sessionId: string
    provider: AgentProvider
    sessionKey: string
    title: string
    createdAt: number
  }>>([])
  const [attentionRespondingId, setAttentionRespondingId] = useState<string | null>(null)
  // Prompt ids already announced via desktop notification (notify once each).
  const attentionNotifiedRef = useRef(new Set<string>())
  // Worktree task orchestration: ⇧F names a task, which spawns a session in an
  // isolated git worktree; merge/discard act on the selected session's task.
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false)
  const [worktreeDraft, setWorktreeDraft] = useState('')
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  // The selected session's worktree task (cwd inside .agent-viewer-worktrees),
  // or null. Drives the composer badge and gates merge/discard.
  const [selectedWorktreeTask, setSelectedWorktreeTask] = useState<WorktreeTask | null>(null)
  const selectedWorktreeTaskCacheRef = useRef(new Map<string, WorktreeTask | null>())
  const [worktreeConfirm, setWorktreeConfirm] = useState<'merge' | 'discard' | null>(null)
  const worktreeSubmitInFlightRef = useRef(false)
  // Runs started this session being watched for terminal/blocked transitions.
  const [coordWatchIds, setCoordWatchIds] = useState<string[]>([])
  const coordWatchStateRef = useRef(new Map<string, { status: string; blockedAgents: Set<string> }>())
  const [coordinationActionBusy, setCoordinationActionBusy] = useState(false)
  // Run the board opens on (a just-started run); null = latest.
  const [coordBoardRunId, setCoordBoardRunId] = useState<string | null>(null)
  // Fleet strip visibility preference (the strip only renders when it has
  // cells: running sessions or fresh background completions).
  const [fleetStripEnabled, setFleetStripEnabled] = useState(true)
  const [fleetPage, setFleetPage] = useState(0)
  // The turn the checkpoints plugin overlay (⇧U) opened on, when a turn summary opened it.
  const [checkpointFocusPrompt, setCheckpointFocusPrompt] = useState<{ sessionId: string; text: string; timestamp?: string } | null>(null)
  // The file-history plugin's overlay. It is a slot of its own rather than the
  // plugin overlay: it sits above whichever surface opened it (the editor, the
  // checkpoints overlay), which stay mounted beneath and get the keys back.
  const [fileHistoryPath, setFileHistoryPath] = useState<string | null>(null)
  const [dailySummaryOpen, setDailySummaryOpen] = useState(false)
  const dailySummaryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const fileHistoryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  const [taskPanelOpen, setTaskPanelOpen] = useEngineeringLocalState('taskPanelOpen', false)
  const [taskPanelTab, setTaskPanelTab] = useEngineeringLocalState<'tasks' | 'agents'>('taskPanelTab', 'tasks')
  const [composerSessions] = useState(createComposerSessions)

  return {
    lastBridgeChatIdRef, bridgeTranscriptEntries, setBridgeTranscriptEntries,
    persistedBridgeCountRef, attentionOpen, setAttentionOpen, attentionKeyHandlerRef,
    backgroundPrompts, setBackgroundPrompts, attentionDone, setAttentionDone,
    attentionRespondingId, setAttentionRespondingId, attentionNotifiedRef, worktreeModalOpen,
    setWorktreeModalOpen, worktreeDraft, setWorktreeDraft, worktreeBusy, setWorktreeBusy,
    selectedWorktreeTask, setSelectedWorktreeTask, selectedWorktreeTaskCacheRef, worktreeConfirm,
    setWorktreeConfirm, worktreeSubmitInFlightRef, coordWatchIds, setCoordWatchIds, coordWatchStateRef, coordinationActionBusy, setCoordinationActionBusy, coordBoardRunId,
    setCoordBoardRunId, fleetStripEnabled,
    setFleetStripEnabled, fleetPage, setFleetPage, checkpointFocusPrompt, setCheckpointFocusPrompt,
    fileHistoryPath, setFileHistoryPath, dailySummaryOpen, setDailySummaryOpen,
    dailySummaryKeyHandlerRef, fileHistoryKeyHandlerRef, taskPanelOpen, setTaskPanelOpen,
    taskPanelTab, setTaskPanelTab, composerSessions,
  }
}
