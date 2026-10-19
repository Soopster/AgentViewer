/** @jsxImportSource @opentui/react */
// A title-bar button: dim at rest, lit under the pointer, acting on press. The
// hover is what tells a terminal user a glyph in a border is clickable at all.
import { memo, useState } from 'react'

import type { TuiThemePalette } from '../theme'

// Memoized: title bars re-render with the root and with every pane, and these
// sit in every one of them.
export const WindowButton = memo(function WindowButton({
  id,
  label,
  theme,
  onPress,
  tone = 'normal',
  background,
}: {
  id?: string
  label: string
  theme: TuiThemePalette
  onPress: () => void
  /** `danger` lights red, for closing. */
  tone?: 'normal' | 'danger'
  /** The border's own background, which the button sits on. */
  background?: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <box
      id={id}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event: { button: number; stopPropagation?: () => void }) => {
        if (event.button !== 0) return
        event.stopPropagation?.()
        onPress()
      }}
    >
      <text
        fg={hovered ? (tone === 'danger' ? theme.red : theme.cyan) : theme.dim}
        bg={hovered ? theme.surface3 : background ?? theme.surface}
        wrapMode="none"
        selectable={false}
      >
        {label}
      </text>
    </box>
  )
})
