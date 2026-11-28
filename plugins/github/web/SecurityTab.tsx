'use client'

import { Button } from '@/components/ui/button'
import type { GithubAlertKind, GithubSecurity } from '@/lib/github/types'
import { Pill, Row, Status, muted, q, useRemote, when } from './shared'

const KIND: Record<GithubAlertKind, string> = { dependabot: 'Dependabot', 'code-scanning': 'Code scanning', 'secret-scanning': 'Secret scanning' }
const tone = (severity: string) => (['critical', 'high', 'error'].includes(severity) ? 'bad' : ['medium', 'moderate', 'warning'].includes(severity) ? 'warn' : undefined) as 'bad' | 'warn' | undefined

export function SecurityTab({ cwd, onAskAgent }: { cwd: string; onAskAgent: (text: string) => void }) {
  const { data, error, loading, reload } = useRemote<{ security: GithubSecurity }>(`/api/github/security?${q({ cwd })}`)
  const security = data?.security
  return (
    <Status loading={loading && !security} error={error}>
      {security ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}>
            <strong>{security.alerts.length} open alert{security.alerts.length === 1 ? '' : 's'}</strong>
            <span style={{ flex: 1 }} /><Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>
          </div>
          {security.unavailable.length > 0 ? (
            <div style={{ padding: '0 12px 8px', ...muted }}>
              Not available (turned off for this repository, or the token cannot read them): {security.unavailable.map((kind) => KIND[kind]).join(', ')}. That is not the same as no alerts.
            </div>
          ) : null}
          {security.alerts.length === 0 && security.unavailable.length < 3 ? <div style={{ padding: '0 12px 12px', ...muted }}>No open alerts in the sources that are enabled.</div> : null}
          {security.alerts.map((alert) => (
            <Row key={`${alert.kind}${alert.number}`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ flex: 1 }}><Pill tone={tone(alert.severity)}>{alert.severity}</Pill><Pill>{KIND[alert.kind]}</Pill><a href={alert.url} target="_blank" rel="noreferrer">{alert.title}</a></span>
                <Button size="sm" variant="ghost" onClick={() => onAskAgent(`Fix this ${KIND[alert.kind]} alert (${alert.severity}): ${alert.title}\n${alert.detail}\n${alert.url}`)}>Ask agent</Button>
              </div>
              <div style={muted}>{alert.detail ? `${alert.detail} · ` : ''}{when(alert.createdAt)}</div>
            </Row>
          ))}
        </>
      ) : null}
    </Status>
  )
}
