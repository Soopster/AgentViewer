/** @jsxImportSource @opentui/react */
// The review guide in the terminal: one stop at a time over the diff it describes.
import React, { useEffect, useRef, useState } from 'react'
import { TextAttributes } from '@opentui/core'
import type { ScrollBoxRenderable } from '@opentui/core'
import { type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { readTuiPrGuide, writeTuiPrGuide } from '../../../lib/tui/github'
import { buildPrGuideQuestion, type PrGuide } from '../../../lib/github/guide'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

export type GuidePanelServices = {
  read: (cwd: string, number: number) => Promise<PrGuide | null>
  write: (cwd: string, number: number) => Promise<PrGuide>
}

const defaultServices: GuidePanelServices = { read: readTuiPrGuide, write: writeTuiPrGuide }

export function GuidePanel({ cwd, pr, theme, width, height, keyRef, onClose, onAsk, onOpenFile, services = defaultServices }: {
  cwd: string
  pr: { number: number; url: string; headRefOid: string }
  theme: TuiThemePalette
  width: number
  height: number
  keyRef: React.RefObject<(key: Key) => void>
  onClose: () => void
  onAsk: (prompt: string) => void
  onOpenFile: (path: string) => void
  services?: GuidePanelServices
}) {
  const [guide, setGuide] = useState<PrGuide | null>(null)
  const [status, setStatus] = useState<'reading' | 'idle' | 'writing'>('reading')
  const [problem, setProblem] = useState('')
  const [at, setAt] = useState(0)
  // A second W while confirming writes: it spends model usage, so one stray key must not.
  const [confirming, setConfirming] = useState(false)
  const scroll = useRef<ScrollBoxRenderable | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    services.read(cwd, pr.number)
      .then(value => { if (live.current) { setGuide(value); setStatus('idle') } })
      .catch((error: unknown) => { if (live.current) { setProblem(error instanceof Error ? error.message : String(error)); setStatus('idle') } })
    return () => { live.current = false }
  }, [cwd, pr.number, services])

  const stop = guide?.stops[Math.min(at, (guide?.stops.length ?? 1) - 1)]
  const move = (next: number) => { setAt(Math.max(0, Math.min(next, (guide?.stops.length ?? 1) - 1))); scroll.current?.scrollTo(0) }

  keyRef.current = (key: Key) => {
    if (key.name === 'escape' || key.sequence === 't' || key.sequence === 'q') { onClose(); return }
    if (key.sequence === 'W') {
      if (status !== 'idle') return
      if (!confirming) { setConfirming(true); return }
      setConfirming(false); setStatus('writing'); setProblem('')
      services.write(cwd, pr.number)
        .then(value => { if (live.current) { setGuide(value); setAt(0); setStatus('idle') } })
        .catch((error: unknown) => { if (live.current) { setProblem(error instanceof Error ? error.message : String(error)); setStatus('idle') } })
      return
    }
    setConfirming(false)
    if (key.name === 'l' || key.name === 'right' || key.sequence === 'n') move(at + 1)
    else if (key.name === 'h' || key.name === 'left' || key.sequence === 'p') move(at - 1)
    else if (key.name === 'j' || key.name === 'down') scroll.current?.scrollBy(2)
    else if (key.name === 'k' || key.name === 'up') scroll.current?.scrollBy(-2)
    else if (key.name === 'return' && stop) { onOpenFile(stop.excerpts[0]!.path); onClose() }
    else if (key.sequence === '?' && stop) onAsk(buildPrGuideQuestion(pr, stop))
  }

  const stale = !!guide && !!pr.headRefOid && guide.headOid !== pr.headRefOid
  const lineWidth = Math.max(width - 4, 20)
  const clip = (value: string) => value.replace(/\t/g, '  ').slice(0, lineWidth)
  const hint = confirming ? 'W again writes it with a Claude model (uses credits) · any other key cancels'
    : status === 'writing' ? 'Writing the guide… this can take a few minutes · esc closes (writing continues)'
    : guide ? `h/l stop · j/k scroll · ⏎ open in diff · ? ask the agent · W rewrite · esc back`
    : 'W write a guide · esc back'

  return (
    <box position="absolute" top={0} left={0} width={width} height={height} zIndex={20} flexDirection="column" backgroundColor={theme.surface} paddingX={1}>
      <text fg={theme.cyan} attributes={TextAttributes.BOLD} wrapMode="none">{clip(guide ? `REVIEW GUIDE  ${Math.min(at, guide.stops.length - 1) + 1}/${guide.stops.length}  #${pr.number}` : `REVIEW GUIDE  #${pr.number}`)}</text>
      {problem ? <text fg={theme.red}>{problem}</text> : null}
      {stale ? <text fg={theme.amber} wrapMode="none">{clip('The pull request changed since this guide: excerpts may not match.')}</text> : null}
      <scrollbox ref={scroll} flexGrow={1} scrollY>
        {status === 'reading' ? <text fg={theme.dim}>Reading…</text>
          : !guide || !stop ? <text fg={theme.muted}>No guide yet. A guide is a tour of this change in reading order: what to read, and where a judgement is needed.</text>
          : (
            <box flexDirection="column">
              {at === 0 && guide.summary ? <box paddingBottom={1}><text fg={theme.muted}>{guide.summary}</text></box> : null}
              <text fg={theme.text} attributes={TextAttributes.BOLD}>{stop.title}</text>
              {stop.lookClosely ? <text fg={theme.amber}>▲ Look closely</text> : null}
              <text fg={theme.text}>{stop.why}</text>
              {stop.excerpts.map((excerpt, index) => (
                <box key={`${at}:${index}`} flexDirection="column" paddingTop={1}>
                  <text fg={theme.cyan} wrapMode="none">{clip(`${excerpt.path} · ${excerpt.startLine}–${excerpt.endLine}`)}</text>
                  {excerpt.lines.map((line, row) => <text key={row} fg={line.startsWith('+') ? theme.green : line.startsWith('-') ? theme.red : theme.muted} wrapMode="none">{clip(line) || ' '}</text>)}
                </box>
              ))}
              {stop.question ? <box paddingTop={1}><text fg={theme.muted}>{`? ${stop.question}`}</text></box> : null}
              {at === guide.stops.length - 1 ? ([['Mechanical changes', guide.mechanical], ['Changed, not on the tour', guide.uncovered], ['Too large to read', guide.unread]] as const).map(([label, files]) => files.length ? (
                <box key={label} flexDirection="column" paddingTop={1}>
                  <text fg={theme.text}>{`${label} (${files.length})`}</text>
                  {files.map(file => <text key={file} fg={theme.dim} wrapMode="none">{clip(`  ${file}`)}</text>)}
                </box>
              ) : null) : null}
            </box>
          )}
      </scrollbox>
      <text fg={confirming ? theme.amber : theme.dim} wrapMode="none">{clip(hint)}</text>
    </box>
  )
}
