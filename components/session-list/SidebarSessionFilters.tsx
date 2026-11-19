'use client'
// The rail's activity filter and its two resting filters, the TUI's ("All
// sessions ▾", ⇧Y scratch, settled) on the web. Scratch hiding and settled
// visibility are shared with the TUI through tui.json; the activity filter is
// this browser's, as it is each workspace's in the terminal.
import { SIDEBAR_ACTIVITY_OPTIONS, type SidebarActivity } from '@/lib/sessionSidebarModel'

const label = { fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 11, color: 'var(--text-3)' } as const

export function SidebarSessionFilters({ activity, onActivity, hideScratch, onHideScratch, showSettled, onShowSettled, hiddenScratch, hiddenSettled, compact, onCompact }: {
  activity: SidebarActivity
  onActivity: (activity: SidebarActivity) => void
  hideScratch: boolean
  onHideScratch: (value: boolean) => void
  showSettled: boolean
  onShowSettled: (value: boolean) => void
  hiddenScratch: number
  hiddenSettled: number
  /** One-row entries (the TUI's outside comfortable density). */
  compact: boolean
  onCompact: (value: boolean) => void
}) {
  const hidden = [hiddenScratch ? `${hiddenScratch} scratch` : '', hiddenSettled ? `${hiddenSettled} settled` : ''].filter(Boolean).join(' · ')
  return (
    <div data-testid="sidebar-session-filters" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select aria-label="Show sessions" value={activity ?? 'all'} onChange={(event) => onActivity(event.target.value === 'all' ? null : event.target.value as SidebarActivity)}
        style={{ fontSize: 12, padding: '4px 6px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>
        {SIDEBAR_ACTIVITY_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ ...label, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }} title="Hide throwaway probe sessions (a bare hi, reply-with-one-word prompts). Named, pinned or live sessions stay.">
          <input type="checkbox" checked={hideScratch} onChange={(event) => onHideScratch(event.target.checked)} /> Hide scratch
        </label>
        <label style={{ ...label, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }} title="Show settled sessions in the list (a search always finds them).">
          <input type="checkbox" checked={showSettled} onChange={(event) => onShowSettled(event.target.checked)} /> Show settled
        </label>
        <label style={{ ...label, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }} title="One line per session: title and age.">
          <input type="checkbox" checked={compact} onChange={(event) => onCompact(event.target.checked)} /> Compact
        </label>
      </div>
      {hidden ? <div style={label}>{hidden} hidden</div> : null}
    </div>
  )
}
