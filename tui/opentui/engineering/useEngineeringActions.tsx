/** @jsxImportSource @opentui/react */
import { useEffect, useState, type RefObject } from 'react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { TuiThemePalette } from '../../theme'
import { EngineeringAction } from './EngineeringAction'
import type { WorkButton } from './EngineeringWorkSections'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }

/** Per-render identities also tolerate a stateless section rendering twice in Strict Mode. */
export function useEngineeringActions(prefix: string, theme: TuiThemePalette, focused: boolean, onFocus: () => void, scroll: RefObject<ScrollBoxRenderable | null>, resetKey: string, pageRows = 8) {
  const [cursor, setCursor] = useState(0)
  const actions = new Map<string, { id: string; index: number; run: () => void }>()
  const button: WorkButton = (id, label, run, selected) => {
    const key = `${prefix}:${id}`
    const index = actions.get(key)?.index ?? actions.size
    actions.set(key, { id: key, index, run })
    return <EngineeringAction key={key} id={key} theme={theme} label={label} selected={selected ?? (focused && cursor === index)}
      onPress={() => { onFocus(); setCursor(index); run() }} />
  }
  const handleKey = (key: Key): boolean => {
    if (['j', 'k', 'up', 'down'].includes(key.name)) {
      const step = key.name === 'j' || key.name === 'down' ? 1 : -1
      setCursor(value => Math.max(0, Math.min(actions.size - 1, value + step))); return true
    }
    if (key.name === 'return') { [...actions.values()][Math.min(cursor, actions.size - 1)]?.run(); return true }
    if (key.name === 'pageup' || key.name === 'pagedown') { scroll.current?.scrollBy(key.name === 'pageup' ? -pageRows : pageRows); return true }
    return false
  }
  useEffect(() => { const action = [...actions.values()][cursor]; if (action) scroll.current?.scrollChildIntoView(action.id) }, [cursor, resetKey])
  return { button, handleKey, setCursor }
}
