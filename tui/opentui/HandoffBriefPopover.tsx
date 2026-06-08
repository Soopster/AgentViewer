/** @jsxImportSource @opentui/react */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable, SyntaxStyle } from '@opentui/core'
import { fetchGitData, type GitData } from '../../lib/gitProvider'
import { runGitCommand } from '../../lib/gitNodeProvider'
import type { Session } from '../../lib/types'
import type { TuiThemePalette } from '../theme'
import type { TuiSessionDetail } from '../../lib/tui/service'
import { buildHandoffBriefMarkdown } from '../../lib/handoffBrief'

type HandoffBriefKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  session: Session | null
  detail: TuiSessionDetail | null
  bookmarkIds: ReadonlySet<string>
  theme: TuiThemePalette
  syntaxStyle: SyntaxStyle
  width: number
  height: number
  onClose: () => void
  onCopy: (text: string) => Promise<void>
  onKeyHandlerReady: (handler: (key: HandoffBriefKeyEvent) => void) => void
}

function briefTitle(session: Session | null, detail: TuiSessionDetail | null): string {
  const info = detail?.info ?? null
  return info?.customTitle ?? info?.summary ?? session?.customTitle ?? session?.summary ?? 'Untitled session'
}

export function HandoffBriefPopover({
  session,
  detail,
  bookmarkIds,
  theme,
  syntaxStyle,
  width,
  height,
  onClose,
  onCopy,
  onKeyHandlerReady,
}: Props) {
  const [gitData, setGitData] = useState<GitData | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  const cwd = detail?.info?.cwd ?? session?.cwd ?? null
  const title = briefTitle(session, detail)
  const briefMarkdown = useMemo(() => buildHandoffBriefMarkdown({
    session,
    detail,
    git: gitData,
    gitError,
    bookmarkIds,
  }), [bookmarkIds, detail, gitData, gitError, session])

  useEffect(() => {
    let cancelled = false
    if (!cwd) {
      setGitData(null)
      setGitError(null)
      setGitLoading(false)
      return () => {
        cancelled = true
      }
    }

    setGitLoading(true)
    setGitError(null)
    void fetchGitData(cwd, runGitCommand)
      .then((data) => {
        if (cancelled) return
        setGitData(data)
      })
      .catch((err) => {
        if (cancelled) return
        setGitData(null)
        setGitError(err instanceof Error ? err.message : 'Failed to load git status')
      })
      .finally(() => {
        if (!cancelled) setGitLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [cwd])

  const handleKey = useCallback((key: HandoffBriefKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'j' || key.name === 'down') { scrollRef.current?.scrollBy(1); return }
    if (key.name === 'k' || key.name === 'up') { scrollRef.current?.scrollBy(-1); return }
    if (key.name === 'd') { scrollRef.current?.scrollBy(10); return }
    if (key.name === 'u') { scrollRef.current?.scrollBy(-10); return }
    if (key.sequence === 'c' || key.sequence === 'C') {
      void onCopy(briefMarkdown)
    }
  }, [briefMarkdown, onClose, onCopy])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 120)
  const popH = Math.min(height - 4, 42)
  const headerH = 4
  const footerH = 2
  const bodyH = Math.max(popH - headerH - footerH - 2, 8)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const sessionLine = [
    session?.provider ?? detail?.info?.provider ?? 'claude',
    title,
    cwd ? cwd : null,
  ].filter(Boolean).join(' · ')

  return (
    <box
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={50}
      flexDirection="column"
      title=" Handoff brief "
      titleColor={theme.cyan}
      titleAlignment="left"
    >
      <box height={headerH} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="column">
        <box flexDirection="row" alignItems="center">
          <text fg={theme.cyan} wrapMode="none">
            {title}
          </text>
          <box flexGrow={1} />
          <text fg={theme.dim} wrapMode="none">
            {gitLoading ? 'loading git…' : gitError ? 'git unavailable' : 'c copy · esc close'}
          </text>
        </box>
        <text fg={theme.dim} wrapMode="none">
          {sessionLine}
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        width={popW - 2}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} paddingTop={1} paddingBottom={1}>
          <markdown
            content={briefMarkdown}
            syntaxStyle={syntaxStyle}
            fg={theme.text}
            streaming={false}
            width={popW - 4}
          />
        </box>
      </scrollbox>

      <box height={footerH} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={theme.dim} wrapMode="none">
          {gitError ? `git unavailable: ${gitError}` : 'j/k scroll · d/u page · c copy · esc close'}
        </text>
      </box>
    </box>
  )
}
