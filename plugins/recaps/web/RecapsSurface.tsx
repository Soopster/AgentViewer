'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The switch for idle recaps. Off by default because a recap sends recent
 * transcript text to a model; the recaps themselves show in the session list
 * and the composer's SUGGESTED chip.
 */
export function RecapsSurface({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/session-recaps').then((r) => r.json()).then((data) => {
      if (!cancelled && typeof data?.enabled === 'boolean') setEnabled(data.enabled)
    }).catch(() => { if (!cancelled) setError('Could not read the recap setting') })
    return () => { cancelled = true }
  }, [])

  const toggle = useCallback(() => {
    const next = !enabled
    setError(null)
    setEnabled(next)
    void fetch('/api/session-recaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then((r) => { if (!r.ok) throw new Error() }).catch(() => {
      setEnabled(!next)
      setError('Could not change the recap setting')
    })
  }, [enabled])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-label="Session recaps"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 16px 48px var(--shadow, rgba(0,0,0,0.3))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
          <Sparkles size={16} /> Session recaps
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--text-2)' }}>
          About a minute after a session goes quiet, a small model reads its last three exchanges and writes a one-line recap
          for the session list, plus a suggested next message when the next step is obvious.
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--text-3)' }}>
          This sends recent transcript text to the model (Claude Haiku by default, or AGENT_VIEWER_RECAP_MODEL).
          Sessions with a live goal, and subagent sessions, are skipped.
        </p>
        {error ? <p role="alert" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red, #f87171)' }}>{error}</p> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" disabled={enabled === null} onClick={toggle}>
            {enabled ? 'Turn off recaps' : 'Turn on recaps'}
          </Button>
        </div>
      </div>
    </div>
  )
}
