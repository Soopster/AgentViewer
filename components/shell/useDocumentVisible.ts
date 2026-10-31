import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
const readVisible = () => document.visibilityState !== 'hidden'
const serverVisible = () => true

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, readVisible, serverVisible)
}
