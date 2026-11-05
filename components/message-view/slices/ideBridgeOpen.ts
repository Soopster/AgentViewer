import type { Session } from '../../../lib/types'
import { useState, useRef } from 'react'
import { useIdeBridge } from '../../useIdeBridge'

export type UseIdeBridgeOpenGroupContext = {
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; } | undefined
  session: Session | null
  ideBridgeOpenRequest: number
  ideBridgeRouteToggleRequest: number
}

export function useIdeBridgeOpenGroup(ctx: UseIdeBridgeOpenGroupContext) {
  const {
    projectView, session, ideBridgeOpenRequest, ideBridgeRouteToggleRequest,
  } = ctx

  // IDE bridge — the third Claude composer flow (agentViewer hosts an IDE
  // endpoint an external `claude` connects to; see channels/agentviewer-ide.ts).
  // Shares the Claude-only availability gate with the channel bridge.
  const [ideBridgeOpen, setIdeBridgeOpen] = useState(false)
  const canUseIdeBridge = !projectView && !!session && (session.provider ?? 'claude') === 'claude'
  const ideBridge = useIdeBridge({ open: ideBridgeOpen, available: canUseIdeBridge })
  const handledIdeBridgeOpenRequestRef = useRef(ideBridgeOpenRequest)
  const handledIdeBridgeRouteRequestRef = useRef(ideBridgeRouteToggleRequest)
  const ideBridgeRef = useRef(ideBridge)

  return {
    ideBridgeOpen, setIdeBridgeOpen, canUseIdeBridge, ideBridge, handledIdeBridgeOpenRequestRef,
    handledIdeBridgeRouteRequestRef, ideBridgeRef,
  }
}
