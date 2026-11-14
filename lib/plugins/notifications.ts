import { createActivityFeed } from './activityFeed'
import type { PluginSessionRef } from './bookmarks'

export type NotificationKind = 'info' | 'success' | 'warning' | 'error'
export type NotificationOptions = {
  readonly title?: string
  readonly target?: PluginSessionRef
  readonly messageUuid?: string
  /** Zero keeps a notification until explicitly dismissed. */
  readonly durationMs?: number
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
