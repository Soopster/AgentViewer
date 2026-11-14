'use client'

import { useMemo, useState } from 'react'

import { McpArtifactLinks } from '../McpArtifacts'
import { mcpResourceLinks } from '@/lib/mcpArtifacts'

import type { ClaudeSystemBlock } from '@/lib/threading'

import { useColorTreatment, washBg } from './appearance'
import { describeClaudeSystem } from './claudeSystemModel'

export function ClaudeSystemCard({ block }: { block: ClaudeSystemBlock }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const flat = useColorTreatment() === 'flat'
  const { subtype, payload } = block
  const { headerLabel, detailPreview, tone, badges, body, payloadJson } = useMemo(
    () => describeClaudeSystem(subtype, payload),
    [subtype, payload],
  )

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderLeft: `2px solid ${tone}`,
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 13,
      marginTop: 4,
      opacity: 0.92,
    }}>
      <div
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: washBg(flat, hovered
            ? `linear-gradient(to right, ${tone}22, var(--surface))`
            : `linear-gradient(to right, ${tone}14, var(--surface))`),
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.12s ease',
        }}
      >
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: tone,
          fontWeight: 600,
          letterSpacing: '0.08em',
          flexShrink: 0,
        }}>
          SYSTEM
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          color: tone,
          fontWeight: 500,
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}>
          {headerLabel}
        </span>
        <span style={{
          fontFamily: "var(--render-font)",
          fontSize: 13,
          color: 'var(--text)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {detailPreview}
        </span>
        {badges.map((badge) => (
          <span
            key={badge}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: tone,
              background: 'var(--surface-2)',
              border: `1px solid ${tone}33`,
              borderRadius: 999,
              padding: '1px 7px',
              flexShrink: 0,
            }}
          >
            {badge}
          </span>
        ))}
        <span style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '10px 12px',
          display: 'grid',
          gap: 10,
        }}>
          <McpArtifactLinks links={mcpResourceLinks(payload.resource_links)} />
          {body && (
            <pre style={{
              margin: 0,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--text-2)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 260,
              overflowY: 'auto',
            }}>
              {body}
            </pre>
          )}
          <pre style={{
            margin: 0,
            padding: '10px 12px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            lineHeight: 1.55,
            color: 'var(--text-3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 260,
            overflowY: 'auto',
          }}>
            {payloadJson}
          </pre>
        </div>
      )}
    </div>
  )
}
