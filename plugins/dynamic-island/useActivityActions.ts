import { useRef, useState } from 'react'
import type { ActivityAction, AppActivity, PluginActivityFeed } from '../../lib/plugins/activityFeed'
import type { PluginActivityControl } from '../../lib/plugins/activityControl'
import type { PluginSessionNavigation } from '../../lib/plugins/bookmarks'
import type { PluginNotifications } from '../../lib/plugins/notifications'
import { activityActions, openLabel } from './actions'

export type ActivityButton = {
  readonly id: string
  readonly label: string
  readonly key?: string
  readonly tone?: 'primary' | 'danger'
  /** Waiting for its second press. */
  readonly armed: boolean
  readonly busy: boolean
  readonly press: () => void
}
export type ActivityStatusLine = { readonly itemId: string; readonly text: string; readonly failed: boolean }

/** Every button a row has and what pressing one does. Both renderers only draw this. */
export function useActivityActions({ feed, notifications, control, navigation, close }: {
  feed: PluginActivityFeed
  notifications: { readonly service: PluginNotifications }
  control: PluginActivityControl | undefined
  navigation: PluginSessionNavigation | undefined
  close: () => void
}) {
  // One action at a time waits for a second press; anything else the person does disarms it.
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [status, setStatus] = useState<ActivityStatusLine | null>(null)
  const running = useRef(new Set<string>())
  const keyOf = (item: AppActivity, actionId: string) => `${item.id}\u0000${actionId}`
  const disarm = () => { setArmed(null); setStatus(null) }
  const open = (item: AppActivity | undefined) => {
    if (item?.target && navigation) { close(); navigation.open(item.target, item.messageUuid) }
  }
  const run = (item: AppActivity, action: ActivityAction) => {
    const id = keyOf(item, action.id)
    setStatus(null)
    if (action.confirm && armed !== id) { setArmed(id); return }
    setArmed(null)
    if (running.current.has(id)) return
    running.current.add(id); setBusy(new Set(running.current))
    if (action.leaves) close()
    new Promise<void>(resolve => resolve(action.run()))
      .then(() => { if (action.done && !action.leaves) setStatus({ itemId: item.id, text: action.done, failed: false }) })
      .catch(error => {
        const text = error instanceof Error ? error.message : 'Action failed'
        // A view that has closed cannot show why, so the app says it.
        if (action.leaves) notifications.service.show('error', text, { title: item.title })
        else setStatus({ itemId: item.id, text, failed: true })
      })
      .finally(() => { running.current.delete(id); setBusy(new Set(running.current)) })
  }
  /** The row's actions, then Open where it has somewhere to go. Dismiss is the renderer's own. */
  const buttons = (item: AppActivity): ActivityButton[] => [
    ...activityActions(item, control).map(action => ({ id: action.id, label: action.label, key: action.key, tone: action.tone,
      armed: armed === keyOf(item, action.id), busy: busy.has(keyOf(item, action.id)), press: () => run(item, action) })),
    ...(item.target && navigation ? [{ id: 'open', label: openLabel(item), armed: false, busy: false, press: () => open(item) }] : []),
  ]
  const dismiss = (item: AppActivity) => { disarm(); feed.dismiss(item.id) }
  return { buttons, open, dismiss, disarm, armed: armed !== null, status }
}
