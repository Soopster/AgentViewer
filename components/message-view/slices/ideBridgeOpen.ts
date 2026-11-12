import { sessionIdentityKey } from '@/lib/sessionIdentity'
import type { Session } from '../../../lib/types'
import { useState, useRef } from 'react'
import { usePresentationInterest } from '../../../lib/plugins/usePresentationInterest'
import { useIdeBridge } from '../../useIdeBridge'

export type UseIdeBridgeOpenGroupContext = {
  projectView: { key: string; sessionCount: number; providerMode: 'current' | 'all'; } | undefined
  session: Session | null
}

export function useIdeBridgeOpenGroup(ctx: UseIdeBridgeOpenGroupContext) {
  const {
    projectView, session,
  } = ctx

  // IDE bridge — the third Claude composer flow (agentViewer hosts an IDE
  // endpoint an external `claude` connects to; see channels/agentviewer-ide.ts).
  // Shares the Claude-only availability gate with the channel bridge.
  const idePresentation = usePresentationInterest()
  const canUseIdeBridge = !projectView && !!session && (session.provider ?? 'claude') === 'claude'
  const ideBridge = useIdeBridge({ open: idePresentation.count > 0, available: canUseIdeBridge, ownerKey: session ? sessionIdentityKey(session) : undefined })
  const ideBridgeRef = useRef(ideBridge)

  return {
    canUseIdeBridge, ideBridge, ideBridgeRef, acquireIdeBridgeView: idePresentation.acquire,
  }
}
