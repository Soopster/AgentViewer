// Compatibility API for existing terminal callers. Presentation is the toasts plugin.
import { tuiNotifications } from '../../lib/plugins/notifications'
import type { AppActivity } from '../../lib/plugins/activityFeed'
import { toBmpSafe } from './bmp'
export type ToastKind = 'default' | 'success' | 'error' | 'info' | 'warning'
export interface Toast { id: number; kind: ToastKind; message: string }
export interface ToastOptions { durationMs?: number }
let previous: readonly AppActivity[] | undefined
let current: Toast[] = []
export function getToasts(): Toast[] {
  const snapshot = tuiNotifications.getSnapshot()
  if (snapshot !== previous) {
    previous = snapshot
    current = snapshot.slice().sort((a, b) => Number(a.id) - Number(b.id)).slice(-4).map(item => ({
      id: Number(item.id), kind: item.source.slice('notifications:'.length) as ToastKind,
      message: toBmpSafe(item.detail ? `${item.title} · ${item.detail}` : item.title),
    }))
  }
  return current
}
export function subscribeToasts(listener: (toasts: Toast[]) => void): () => void {
  return tuiNotifications.subscribe(() => listener(getToasts()))
}
export function dismissToast(id: number): void { tuiNotifications.service.dismiss(String(id)) }
export function dismissAllToasts(): void { for (const item of tuiNotifications.getSnapshot()) tuiNotifications.service.dismiss(item.id) }
function push(kind: ToastKind, message: string, options?: ToastOptions): number {
  return Number(tuiNotifications.service.show(kind === 'default' ? 'info' : kind, toBmpSafe(message), options))
}
export const toast = {
  message: (message: string, options?: ToastOptions) => push('default', message, options),
  success: (message: string, options?: ToastOptions) => push('success', message, options),
  error: (message: string, options?: ToastOptions) => push('error', message, options),
  info: (message: string, options?: ToastOptions) => push('info', message, options),
  warning: (message: string, options?: ToastOptions) => push('warning', message, options),
}
