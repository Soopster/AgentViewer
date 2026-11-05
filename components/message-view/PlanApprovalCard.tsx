'use client'
import type { PendingPermission } from '../../lib/permissions'
import { Button } from '../ui/button'

// Interactive answer surface for a Claude AskUserQuestion prompt. Collects a
// selection per question (single or multi) and submits the answers map back to
// the running turn. Lives in the composer's pending-approval area.
// Plan-approval surface for Claude's ExitPlanMode. Shows the plan + the
// prompt-based permissions it needs, and lets the user approve (exiting plan
// mode into accept-edits or default) or keep planning.
export function PlanApprovalCard({
  permission, busy, onApprove, onReject,
}: {
  permission: PendingPermission
  busy: boolean
  onApprove: (mode: 'acceptEdits' | 'default') => void
  onReject: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 11px',
        borderRadius: 6,
        border: '1px solid rgba(45,212,160,0.30)',
        background: 'rgba(45,212,160,0.06)',
      }}
    >
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--green)', letterSpacing: '0.06em' }}>
        ● CLAUDE FINISHED PLANNING
      </div>
      {permission.plan && (
        <div style={{
          maxHeight: 260,
          overflow: 'auto',
          padding: '8px 10px',
          borderRadius: 4,
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          fontFamily: "'IBM Plex Sans', sans-serif",
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--text-2)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {permission.plan}
        </div>
      )}
      {permission.allowedPrompts && permission.allowedPrompts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
            APPROVING ALLOWS
          </div>
          {permission.allowedPrompts.map((p, i) => (
            <div key={i} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-2)' }}>
              · {p}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button
          type="button"
          onClick={onReject}
          disabled={busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            border: '1px solid rgba(234,170,64,0.30)',
            background: 'rgba(234,170,64,0.08)',
            color: 'var(--amber, #eaaa40)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.06em',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          KEEP PLANNING
        </Button>
        <Button
          type="button"
          onClick={() => onApprove('default')}
          disabled={busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 10px', borderRadius: 4,
            border: '1px solid rgba(45,212,160,0.30)',
            background: 'rgba(45,212,160,0.08)',
            color: 'var(--green)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.06em',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          APPROVE · ASK PER TOOL
        </Button>
        <Button
          type="button"
          onClick={() => onApprove('acceptEdits')}
          disabled={busy}
          variant="outline"
          size="sm"
          style={{
            height: 26, padding: '0 12px', borderRadius: 4,
            border: '1px solid rgba(45,212,160,0.45)',
            background: 'rgba(45,212,160,0.16)',
            color: 'var(--green)',
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, letterSpacing: '0.06em',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.55 : 1,
          }}
        >
          {busy ? 'Starting…' : 'Approve · auto-accept edits'}
        </Button>
      </div>
    </div>
  )
}
