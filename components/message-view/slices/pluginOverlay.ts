import type { ComposerSessions } from '../../../lib/composerSessions'
import type { Session } from '../../../lib/types'
import { type ProtocolAgent } from '@/lib/agentProtocol'
import { useState, useRef, useMemo } from 'react'
import { type SessionDiagnosticSection } from '@/lib/types'
import { getPluginSurface, type PluginSurfaceId } from '@/lib/plugins/catalog'
import { useDisabledPlugins } from '@/lib/plugins/useDisabledPlugins'
import { useComposerSessionState } from '@/lib/composerSessions'
import { type WebPluginServices } from '../../shell/pluginTypes'
import { type SteeredSendEntry } from '../types'

export type UsePluginOverlayGroupContext = {
  session: Session | null
  hideCoordinator: boolean
  onOpenSession: ((session: Session) => void) | undefined
  onInspectTeammate: ((agent: ProtocolAgent) => void) | undefined
  returnToChat: () => void
  updateTeamAttention: (count: number) => void
  composerSessions: ComposerSessions
  composerOwnerKey: string
}

export function usePluginOverlayGroup(ctx: UsePluginOverlayGroupContext) {
  const {
    session, hideCoordinator, onOpenSession, onInspectTeammate, returnToChat, updateTeamAttention,
    composerSessions, composerOwnerKey,
  } = ctx

  // The plugin surface open as an overlay, if any (lib/plugins/catalog.ts).
  const [pluginOverlay, setPluginOverlay] = useState<PluginSurfaceId | null>(null)
  const disabledPlugins = useDisabledPlugins()
  // The conversation's Teammates tab is the Coordination plugin's view; with it
  // off the tab is gone and the team keeps running server-side.
  const teammatesTab = Boolean(session && !hideCoordinator && !disabledPlugins.has(getPluginSurface('teammates').pluginId))
  const teammatesServices = useMemo<WebPluginServices>(() => ({
    coordination: {
      provider: session?.provider ?? 'claude',
      selectedSession: session ?? null,
      openSession: onOpenSession ?? (() => {}),
      ...(onInspectTeammate ? { inspectTeammate: onInspectTeammate } : {}),
      returnToChat,
      attentionChanged: updateTeamAttention,
    },
  }), [session, onOpenSession, onInspectTeammate, returnToChat, updateTeamAttention])
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [diagnosticSections, setDiagnosticSections] = useState<SessionDiagnosticSection[]>([])
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [cliPopoverOpen, setCliPopoverOpen] = useState(false)
  const cliPopoverRef = useRef<HTMLDivElement>(null)
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false)
  const viewDropdownRef = useRef<HTMLDivElement>(null)
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false)
  const actionsDropdownRef = useRef<HTMLDivElement>(null)
  const [sessionActionLoading, setSessionActionLoading] = useState<string | null>(null)
  const [sessionActionError, setSessionActionError] = useState<string | null>(null)
  const [sessionActionNotice, setSessionActionNotice] = useState<string | null>(null)
  const [optimisticContextText, setOptimisticContextText] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'optimisticContextText', null)
  const [optimisticUserText, setOptimisticUserText] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'optimisticUserText', null)
  // Messages steered INTO the running turn — echoed in the live overlay until
  // the persisted transcript reconciles (same lifecycle as optimisticUserText).
  // `messageUuid` is the server's uuid stamp; command_lifecycle frames
  // correlate on it and drive `state` (queued/started/completed) or drop the
  // entry entirely (cancelled/discarded).
  const [steeredUserTexts, setSteeredUserTexts] = useComposerSessionState<SteeredSendEntry[]>(composerSessions, composerOwnerKey, 'steeredUserTexts', [])
  const steeredUserTextsRef = composerSessions.ref<SteeredSendEntry[]>(composerOwnerKey, 'steeredUserTextsRef', [])

  return {
    pluginOverlay, setPluginOverlay, disabledPlugins, teammatesTab, teammatesServices,
    diagnosticsLoading, setDiagnosticsLoading, diagnosticSections, setDiagnosticSections,
    exporting, setExporting, deleting, setDeleting, cliPopoverOpen, setCliPopoverOpen,
    cliPopoverRef, viewDropdownOpen, setViewDropdownOpen, viewDropdownRef, actionsDropdownOpen,
    setActionsDropdownOpen, actionsDropdownRef, sessionActionLoading, setSessionActionLoading,
    sessionActionError, setSessionActionError, sessionActionNotice, setSessionActionNotice,
    optimisticContextText, setOptimisticContextText, optimisticUserText, setOptimisticUserText,
    steeredUserTexts, setSteeredUserTexts, steeredUserTextsRef,
  }
}
