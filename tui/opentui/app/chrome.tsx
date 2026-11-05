/** @jsxImportSource @opentui/react */
import React, { useState, useEffect } from 'react'
import type { TuiThemePalette } from '../../theme'
import { contextBarColor } from './contextMeter'
import { stableHash, formatElapsedClock } from './format'
import { type InlineTextSegment, renderInlineTextSegments } from './inlineText'
import { useWindowVisible } from '../windowActivity'

const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
// A tab for a session with a turn in flight spins, so work you are not looking
// at is still visible. Exported for the smoke, which cannot assert on a glyph
// it does not share with the renderer.
export const TAB_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
export const TAB_SPINNER_INTERVAL_MS = 100
const COMPOSER_WAITING_SPINNER_FRAMES = [
  ['|', '/', '-', '\\'],
  ['.', 'o', 'O', 'o'],
  ['◐', '◓', '◑', '◒'],
  ['▖', '▘', '▝', '▗'],
  ['◜', '◝', '◞', '◟'],
] as const
// Exported so liveToolStreamSmoke can assert none of them are on screen
// while a turn runs — the idle ticker and the pinned turn status are mutually
// exclusive, and a stale "waiting patiently" above a live turn is a lie.
// Equally, no phrase may claim work is happening: this shows while idle.
export const IDLE_TICKER_PHRASES = [
  'waiting for new messages',
  'listening for activity',
  'standing by',
  'watching the wire',
  'all quiet on the western front',
  'ready when you are',
  'nothing new — yet',
  'on standby',
  'holding position',
  'idle — pinging occasionally',
  'no new messages',
  'biding its time',
  'waiting patiently',
  'keeping watch',
] as const
const IDLE_TICKER_ROTATE_MS = 8000
// Each spinner step is a whole frame: OpenTUI redraws the full renderable tree
// and diffs it, so the cost of a tick grows with what is mounted, not with the
// one glyph that changed. The idle ticker is on screen for as long as the app
// sits idle — at the 80ms of an in-progress spinner it was most of the TUI's
// idle CPU. Standby does not need to look urgent.
const IDLE_TICKER_FRAME_MS = 400
const IDLE_TICKER_SPINNER_VARIANTS: ReadonlyArray<readonly string[]> = [
  ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'], // braille circle
  ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], // braille sweep
  ['◐', '◓', '◑', '◒'], // half-circle
  ['◜', '◝', '◞', '◟'], // arc
  ['▖', '▘', '▝', '▗'], // block quadrant
  ['|', '/', '-', '\\'], // ASCII classic
  ['.', 'o', 'O', 'o'], // dot pulse
  ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'], // arrow spin
]
const COMPOSER_WAITING_MESSAGES = [
  'Adding context',
  'Composing the reply',
  'Shaping the next move',
  'Reading the room',
  'Checking the map',
  'Threading the details',
  'Warming the context',
  'Letting the agent work',
  'Lining up the response',
  'Waiting on the model',
] as const
export class TuiErrorBoundary extends React.Component<
  { children: React.ReactNode} , { error: Error | null} 
> {
  constructor(props: { children: React.ReactNode} ) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    const { error } = this.state
    if (error) {
      return (
        <box flexDirection="column" paddingX={2} paddingY={1}>
          <text fg="#ff6b6b" wrapMode="word">Render error: {error.message}</text>
          <text fg="#888888" wrapMode="none">Malformed transcript — scroll past this card or reload.</text>
        </box>
      )
    }
    return this.props.children
  }
}
export function Spinner({
  label, fg, labelFg = fg, frames = SPINNER_FRAMES, intervalMs = 80,
}: {
  label: string
  fg: string
  labelFg?: string
  frames?: readonly string[]
  intervalMs?: number
}) {
  const visible = useWindowVisible()
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), intervalMs)
    return () => clearInterval(id)
  }, [visible, frames, intervalMs])
  return (
    <text wrapMode="none">
      <span fg={fg}>{frames[frame % frames.length]}</span>
      <span fg={labelFg}>{` ${label}`}</span>
    </text>
  )
}
export function IdleTicker({ seed, theme }: { seed: string; theme: TuiThemePalette} ) {
  const visible = useWindowVisible()
  const hash = stableHash(seed)
  const spinnerFrames = IDLE_TICKER_SPINNER_VARIANTS[hash % IDLE_TICKER_SPINNER_VARIANTS.length]!
  const [phraseIndex, setPhraseIndex] = useState(() => (hash >>> 8) % IDLE_TICKER_PHRASES.length)
  useEffect(() => {
    if (!visible) return
    const id = setInterval(
      () => setPhraseIndex((i) => (i + 1) % IDLE_TICKER_PHRASES.length),
      IDLE_TICKER_ROTATE_MS
    )
    return () => clearInterval(id)
  }, [visible])
  return (
    <Spinner
      label={IDLE_TICKER_PHRASES[phraseIndex]!}
      fg={theme.cyan}
      labelFg={theme.violet}
      frames={spinnerFrames}
      intervalMs={IDLE_TICKER_FRAME_MS} />
  )
}
export function ComposerWaitingStatus({
  startedAt, seed, suffix, theme, width, message: messageOverride,
}: {
  startedAt: number | null
  seed: string
  suffix: string | null
  theme: TuiThemePalette
  width: number
  /** What the turn is actually waiting on, when that is the user. */
  message?: string | null
}) {
  const visible = useWindowVisible()
  const [frame, setFrame] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const hash = stableHash(seed)
  const frames = COMPOSER_WAITING_SPINNER_FRAMES[hash % COMPOSER_WAITING_SPINNER_FRAMES.length] ?? COMPOSER_WAITING_SPINNER_FRAMES[0]
  const message = messageOverride ?? COMPOSER_WAITING_MESSAGES[hash % COMPOSER_WAITING_MESSAGES.length] ?? COMPOSER_WAITING_MESSAGES[0]

  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => {
      setFrame((current) => current + 1)
      setNow(Date.now())
    }, 120)
    return () => clearInterval(id)
  }, [visible])

  const elapsed = formatElapsedClock(startedAt == null ? 0 : Math.max(now - startedAt, 0))
  // Segment the status so the live metadata reads as labelled chips: spinner +
  // message in accent, elapsed bright, then each "key:value" pair with a dim
  // key and a brighter value (ctx % colored by pressure).
  const segs: InlineTextSegment[] = [
    { text: `${frames[frame % frames.length]} `, fg: theme.cyan },
    { text: `${message}…`, fg: theme.text },
    { text: `  ${elapsed}`, fg: theme.cyan },
  ]
  if (suffix) {
    for (const chip of suffix.split(' · ')) {
      segs.push({ text: '  ·  ', fg: theme.dim })
      const colon = chip.indexOf(':')
      if (colon > 0) {
        const key = chip.slice(0, colon)
        const value = chip.slice(colon + 1)
        segs.push({ text: `${key} `, fg: theme.dim })
        if (key === 'ctx') {
          const m = value.match(/(\d+)%/)
          const valColor = m ? contextBarColor(Number(m[1]), theme) : theme.muted
          segs.push({ text: value, fg: valColor })
        } else {
          segs.push({ text: value, fg: theme.muted })
        }
      } else {
        segs.push({ text: chip, fg: theme.muted })
      }
    }
  }
  return <text wrapMode="none">{renderInlineTextSegments(segs, width, theme.dim)}</text>
}
