/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { readTuiProtocolRun } from '../../../../lib/tui/service'
import { type NoticeTone } from '../types'
import { keepFiltered } from '../collections'

export type CoordWatchEffectContext = {
  coordWatchIds: string[]
  coordWatchStateRef: React.RefObject<Map<string, { status: string; blockedAgents: Set<string>; }>>
  setCoordWatchIds: React.Dispatch<React.SetStateAction<string[]>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  notifyTeamEvent: (title: string, body: string) => void
}

export function runCoordWatchEffect(ctx: CoordWatchEffectContext) {
  const {
    coordWatchIds, coordWatchStateRef, setCoordWatchIds, showNotice, notifyTeamEvent,
  } = ctx
  if (coordWatchIds.length === 0) return
  let cancelled = false
  const tick = async () => {
    for (const runId of coordWatchIds) {
      const snapshot = await readTuiProtocolRun(runId).catch(() => null)
      if (cancelled) return
      const watch = coordWatchStateRef.current.get(runId)
      if (!snapshot || !watch) {
        coordWatchStateRef.current.delete(runId)
        setCoordWatchIds((prev) => keepFiltered(prev, (id) => id !== runId))
        continue
      }
      for (const agent of snapshot.agents) {
        if (agent.status === 'blocked' && !watch.blockedAgents.has(agent.id)) {
          watch.blockedAgents.add(agent.id)
          showNotice('info', `Team: ${agent.name} is blocked${agent.taskId ? ` on ${agent.taskId}` : ''} — ⌃K a to intervene`, 6000)
          notifyTeamEvent('teammate blocked', `${agent.name} is blocked${agent.taskId ? ` on ${agent.taskId}` : ''}`)
        }
      }
      const status = snapshot.run.status
      if (status !== watch.status) {
        watch.status = status
        if (status === 'completed' || status === 'failed' || status === 'stopped') {
          const headline = snapshot.run.summary?.split('\n')[0] ?? ''
          showNotice(status === 'completed' ? 'info' : 'error', `Team run ${status}${headline ? `: ${headline}` : ''} — ⌃K a for the board`, 8000)
          notifyTeamEvent(`team run ${status}`, headline || snapshot.run.prompt.slice(0, 80))
          coordWatchStateRef.current.delete(runId)
          setCoordWatchIds((prev) => keepFiltered(prev, (id) => id !== runId))
        }
      }
    }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, 5000)
  return () => { cancelled = true; clearInterval(timer) }
}
