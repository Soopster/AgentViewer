/** @jsxImportSource @opentui/react */
import { createContext, useContext, type ReactNode } from 'react'

/** The workspace owns inspector state; the window manager owns its frame. */
export const EngineeringInspectorContext = createContext<((width: number, height: number) => ReactNode) | null>(null)

export function EngineeringInspectorWindow({ width, height }: { width: number; height: number }) {
  const inspector = useContext(EngineeringInspectorContext)
  return inspector ? inspector(width, height) : <text>Inspector unavailable.</text>
}
