'use client'

import { useContext } from 'react'
import { TeamAttentionContext } from './contexts'
import { sessionAttentionPresentation } from './presentation'

export function SessionAttentionBadge({ sessionKey }: { sessionKey: string }) {
  const attention = sessionAttentionPresentation(useContext(TeamAttentionContext)[sessionKey])
  if (!attention) return null
  return (
    <span
      title={attention.title}
      style={{
        flexShrink: 0,
        fontSize: 11,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 999,
        color: attention.color,
        border: `1px solid ${attention.color}`,
        opacity: 0.85,
      }}
    >
      {attention.label}
    </span>
  )
}
