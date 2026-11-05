import type { SendState } from './types'
import type { WebComposerQueueDurability } from './webComposerQueue'

export type ComposerRuntimePhase =
  | 'preparing'
  | 'ready'
  | 'sending'
  | 'streaming'
  | 'retrying'
  | 'compacting'
  | 'reconciling'
  | 'reattaching'
  | 'interrupting'
  | 'blocked'
  | 'offline'
  | 'error'

export type ComposerTransportState = 'unknown' | 'ready' | 'active' | 'blocked' | 'offline' | 'error'
export type ComposerTranscriptState = 'idle' | 'live' | 'syncing' | 'cached' | 'error'
export type ComposerQueueState = 'empty' | 'saving' | 'durable' | 'memory-only'
export type ComposerRuntimeTone = 'neutral' | 'active' | 'warning' | 'error'

export type ComposerRuntimeState = {
  phase: ComposerRuntimePhase
  transport: ComposerTransportState
  transcript: ComposerTranscriptState
  queue: ComposerQueueState
  label: string
  detail: string
  tone: ComposerRuntimeTone
}
export type ComposerRuntimeInput = {
  hasSession: boolean
  preparing?: boolean
  sendState: SendState
  awaitingPersistedTurn: boolean
  reattachedRunning: boolean
  interrupting: boolean
  liveStatus: 'requesting' | 'compacting' | 'retrying' | null
  hasLiveOutput: boolean
  activeToolCount: number
  queuedCount: number
  queueDurability: WebComposerQueueDurability
  blockedReason?: string | null
  offline?: boolean
}

function queueState(count: number, durability: WebComposerQueueDurability): ComposerQueueState {
  if (count === 0) return 'empty'
  return durability
}

function queuedDetail(count: number): string {
  if (count === 0) return ''
  return count === 1 ? ' One follow-up is queued.' : ` ${count} follow-ups are queued.`
}

export function deriveComposerRuntimeState(input: ComposerRuntimeInput): ComposerRuntimeState {
  const queue = queueState(input.queuedCount, input.queueDurability)
  const queued = queuedDetail(input.queuedCount)

  if (input.offline) {
    return {
      phase: 'offline',
      transport: 'offline',
      transcript: 'cached',
      queue,
      label: 'Offline',
      detail: 'Showing cached transcript data. Sending resumes when the runtime reconnects.',
      tone: 'warning',
    }
  }
  if (input.blockedReason) {
    return {
      phase: 'blocked',
      transport: 'blocked',
      transcript: 'idle',
      queue,
      label: 'Blocked',
      detail: input.blockedReason,
      tone: 'warning',
    }
  }
  if (input.sendState === 'error') {
    return {
      phase: 'error',
      transport: 'error',
      transcript: 'error',
      queue,
      label: 'Send failed',
      detail: `The draft was restored and is safe to retry.${queued}`,
      tone: 'error',
    }
  }
  if (input.interrupting) {
    return {
      phase: 'interrupting',
      transport: 'active',
      transcript: input.awaitingPersistedTurn ? 'syncing' : 'live',
      queue,
      label: 'Interrupting',
      detail: 'Stopping the turn and preserving the output received so far.',
      tone: 'warning',
    }
  }
  if (input.awaitingPersistedTurn) {
    return {
      phase: 'reconciling',
      transport: 'ready',
      transcript: 'syncing',
      queue,
      label: 'Synchronizing transcript',
      detail: `The turn finished; waiting for its durable transcript rows.${queued}`,
      tone: 'active',
    }
  }
  if (input.reattachedRunning) {
    return {
      phase: 'reattaching',
      transport: 'ready',
      transcript: 'cached',
      queue,
      label: 'Reattached to running turn',
      detail: `The provider still owns the turn; output appears as it is persisted.${queued}`,
      tone: 'active',
    }
  }
  if (input.sendState === 'sending') {
    if (input.liveStatus === 'retrying') {
      return {
        phase: 'retrying',
        transport: 'active',
        transcript: input.hasLiveOutput ? 'live' : 'idle',
        queue,
        label: 'Retrying provider request',
        detail: `The runtime is recovering from a transient provider error.${queued}`,
        tone: 'warning',
      }
    }
    if (input.liveStatus === 'compacting') {
      return {
        phase: 'compacting',
        transport: 'active',
        transcript: input.hasLiveOutput ? 'live' : 'idle',
        queue,
        label: 'Compacting conversation',
        detail: `The runtime is freeing context before continuing.${queued}`,
        tone: 'active',
      }
    }
    if (input.hasLiveOutput || input.activeToolCount > 0) {
      const activity = input.activeToolCount > 0
        ? ` The agent is using ${input.activeToolCount} tool${input.activeToolCount === 1 ? '' : 's'}.`
        : ''
      return {
        phase: 'streaming',
        transport: 'active',
        transcript: 'live',
        queue,
        label: 'Streaming response',
        detail: `Live provider output is updating the transcript.${activity}${queued}`,
        tone: 'active',
      }
    }
    return {
      phase: 'sending',
      transport: 'active',
      transcript: 'idle',
      queue,
      label: input.liveStatus === 'requesting' ? 'Waiting for provider' : 'Sending message',
      detail: `The runtime accepted the request and is waiting for output.${queued}`,
      tone: 'active',
    }
  }
  if (!input.hasSession || input.preparing) {
    return {
      phase: 'preparing',
      transport: 'unknown',
      transcript: 'idle',
      queue,
      label: 'Preparing runtime',
      detail: 'Loading the session runtime and composer capabilities.',
      tone: 'neutral',
    }
  }
  if (queue === 'memory-only') {
    return {
      phase: 'ready',
      transport: 'ready',
      transcript: 'idle',
      queue,
      label: 'Ready · queue is memory only',
      detail: 'Browser storage is unavailable. Keep this tab open or edit queued messages back into the composer.',
      tone: 'warning',
    }
  }
  return {
    phase: 'ready',
    transport: 'ready',
    transcript: 'idle',
    queue,
    label: 'Ready',
    detail: input.queuedCount > 0
      ? `${input.queuedCount} follow-up${input.queuedCount === 1 ? ' is' : 's are'} saved and ready to send in order.`
      : 'The runtime is ready for a message.',
    tone: 'neutral',
  }
}
