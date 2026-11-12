import type { AddressableSession } from '@/lib/crossSessionMessagingTypes'

export type MessagingFeedback = { kind: 'success' | 'error'; text: string }

/** Presentation contract shared by standalone and embedded messaging. */
export type MessagingWorkspaceModel = {
  sessions: AddressableSession[]
  selectedSessionId: string
  message: string
  loading: boolean
  sending: boolean
  feedback: MessagingFeedback | null
  setMessage: (text: string) => void
  selectSession: (sessionId: string) => void
  sendMessage: () => Promise<void>
  refresh: (foreground?: boolean) => Promise<void>
}
