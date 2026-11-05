// The state of a coding agent running inside a shell tab, read off its screen
// (herdr's pane detection, lib/terminalAgentDetect.ts). A tab that holds no
// recognisable agent has no entry, so a plain shell looks exactly as before.
import { useEffect, useRef, useState } from 'react'
import { classifyAnyAgent, type TerminalAgentState } from '../../../lib/terminalAgentDetect.mjs'
import { shellTerminal, type ShellSession } from '../../../tui/opentui/shell/sdkTerminal'
import { readVisibleScreenText, type ScreenSource } from './shellScreen'

export type ShellAgentState = { agent: string; state: TerminalAgentState }

const POLL_MS = 700

export function readShellAgentState(shell: Pick<ShellSession, 'id' | 'title'>, previous?: ShellAgentState): ShellAgentState | null {
  const term = shellTerminal(shell.id)
  if (!term) return null
  const found = classifyAnyAgent({ lines: readVisibleScreenText(term as unknown as ScreenSource), title: shell.title ?? undefined })
  if (!found) return previous ?? null
  // A view that says nothing about the agent (a transcript pager) keeps what was known.
  if (found.detection.keepState || found.detection.state === 'unknown') return previous ?? { agent: found.agent, state: 'unknown' }
  return { agent: found.agent, state: found.detection.state }
}

/**
 * Polls only while a shell is running, and sets state only when an answer
 * changes: an idle terminal pane must not commit on every tick.
 */
export function useShellAgentStates(shells: readonly ShellSession[]): ReadonlyMap<string, ShellAgentState> {
  const [states, setStates] = useState<ReadonlyMap<string, ShellAgentState>>(() => new Map())
  const shellsRef = useRef(shells)
  shellsRef.current = shells
  const running = shells.some((shell) => shell.status === 'running')
  useEffect(() => {
    if (!running) return
    const tick = () => {
      setStates((previous) => {
        const next = new Map<string, ShellAgentState>()
        for (const shell of shellsRef.current) {
          if (shell.status !== 'running') continue
          const answer = readShellAgentState(shell, previous.get(shell.id))
          if (answer) next.set(shell.id, answer)
        }
        const same = next.size === previous.size && [...next].every(([id, value]) => {
          const old = previous.get(id)
          return old?.agent === value.agent && old.state === value.state
        })
        return same ? previous : next
      })
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => clearInterval(timer)
  }, [running])
  return states
}
