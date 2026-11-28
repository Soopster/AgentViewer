'use client'
// Installs the Web renderer's sink for card interactions: a batched POST to the daemon, and a final
// beacon when the tab is hidden so a short visit is still counted. Imported for its effect.
import { flushUiInteractions, setUiInteractionSink } from './uiInteractions'

if (typeof window !== 'undefined') {
  setUiInteractionSink(async reports => {
    const body = JSON.stringify({ reports })
    if (document.visibilityState === 'hidden' && navigator.sendBeacon?.('/api/plugins/ui-interaction', new Blob([body], { type: 'application/json' }))) return
    await fetch('/api/plugins/ui-interaction', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
  })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUiInteractions() })
}
