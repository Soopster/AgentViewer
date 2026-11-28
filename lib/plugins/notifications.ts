import { createActivityFeed } from './activityFeed'
import { holdDelivery } from './deliveryGate'
import type { PluginSessionRef } from './bookmarks'

export type NotificationKind = 'info' | 'success' | 'warning' | 'error'
export type NotificationOptions = {
  readonly title?: string
  readonly target?: PluginSessionRef
  readonly messageUuid?: string
  /** Zero keeps a notification until explicitly dismissed. */
  readonly durationMs?: number
  /** Asks something of the person, so a focus block never holds it (warnings and errors always are). */
  readonly urgent?: boolean
}
/** Plugins publish once. Enabled presentation plugins independently consume it. */
export type PluginNotifications = {
  readonly show: (kind: NotificationKind, message: string, options?: NotificationOptions) => string
  readonly dismiss: (id: string) => void
}

export function createNotificationCenter(clock: () => number = Date.now) {
  const feed = createActivityFeed(clock)
  let sequence = 0
  const service: PluginNotifications = {
    show(kind, message, options = {}) {
      const id = String(++sequence)
      // A warning or error asks something of the person; anything else may be held by a focus block.
      if (holdDelivery({ channel: 'toast', urgent: options.urgent === true || kind === 'warning' || kind === 'error', title: options.title || message, detail: options.title ? message : undefined, target: options.target })) return id
      const duration = options.durationMs ?? (kind === 'error' ? 0 : 6000)
      feed.publish({ id, source: `notifications:${kind}`, status: kind === 'warning' ? 'waiting' : kind,
        title: options.title || message, detail: options.title ? message : undefined,
        target: options.target, messageUuid: options.messageUuid,
        expiresAt: duration > 0 ? clock() + duration : undefined })
      return id
    },
    dismiss: feed.remove,
  }
  return { ...feed, service }
}

export const webNotifications = createNotificationCenter()
export const tuiNotifications = createNotificationCenter()
