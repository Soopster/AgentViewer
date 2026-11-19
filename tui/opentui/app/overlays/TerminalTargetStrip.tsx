/** @jsxImportSource @opentui/react */
import React, { useEffect, useState } from 'react'
import type { TuiThemePalette } from '../../../theme'
import { shellTerminal } from '../../shell/sdkTerminal'
import { readVisibleScreenText, type ScreenSource } from '../../shellScreen'
import { readTerminalAgentState } from '../../terminalPrompt'

export const TERMINAL_STRIP_ROWS = 4
const POLL_MS = 700

type Tail = { name: string; state: string | null; lines: string[] }

/**
 * What the composer's target terminal is showing, so a prompt can be written
 * against its answer. It reads only while a terminal is targeted, and sets state
 * only when the text changes: an idle strip must not commit on every tick.
 */
export function TerminalTargetStrip(props: { targets: readonly { id: string; name: string }[]; theme: TuiThemePalette; left: number; width: number; bottom: number }) {
  const { targets, theme, left, width, bottom } = props
  const [tails, setTails] = useState<Tail[]>([])
  useEffect(() => {
    let alive = true
    const read = async () => {
      const next: Tail[] = []
      for (const target of targets.slice(0, 2)) {
        const term = shellTerminal(target.id)
        const screen = term ? readVisibleScreenText(term as unknown as ScreenSource) : []
        while (screen.length > 0 && screen[screen.length - 1]!.trim() === '') screen.pop()
        next.push({ name: target.name, state: await readTerminalAgentState(target.id), lines: screen.slice(-TERMINAL_STRIP_ROWS) })
      }
      if (alive) setTails(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
    }
    void read()
    const timer = setInterval(() => { void read() }, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [targets])
  if (tails.length === 0) return null
  const cell = Math.max(10, width - 4)
  return (
    <box position="absolute" left={left} bottom={bottom} width={width} flexDirection="column" backgroundColor={theme.surface} border borderStyle="single" borderColor={theme.border} zIndex={4}>
      {tails.map(tail => (
        <box key={tail.name} flexDirection="column">
          <text fg={tail.state === 'blocked' ? theme.cyan : theme.dim} wrapMode="none">{`${tail.name}${tail.state ? ` · ${tail.state}` : ''}`}</text>
          {tail.lines.map((line, index) => <text key={index} fg={theme.text} wrapMode="none">{line.slice(0, cell)}</text>)}
        </box>
      ))}
    </box>
  )
}
