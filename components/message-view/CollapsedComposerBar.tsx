import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'

type CollapsedComposerBarProps = {
  isProject: boolean
  composerCollapsed: boolean
  setComposerCollapsed: Dispatch<SetStateAction<boolean>>
}

export function CollapsedComposerBar(props: CollapsedComposerBarProps) {
  const {
    isProject, composerCollapsed, setComposerCollapsed,
  } = props
  return (
    !isProject && composerCollapsed && (
        <div
          style={{
            padding: '4px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className="av-hover-control"
            onClick={() => setComposerCollapsed(false)}
            title="Expand composer"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--text-3)',
              padding: '2px 8px',
              borderRadius: 6,
              lineHeight: 1,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            ▲ COMPOSER
          </button>
        </div>
      )
  )
}
