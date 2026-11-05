/** @jsxImportSource @opentui/react */
import React, { useSyncExternalStore } from 'react'
import type { TuiThemePalette } from '../../theme'
import type { Session } from '../../../lib/types'
import { fitText, joinMeta } from '../textLayout'
import { peekGitSummaryCached, subscribeGitSummary } from '../gitSummaryCache'

export const PR_STATE_GLYPH = '⇄'

export function pullRequestMark(session: Session): { text: string; state: string } | null {
  const pr = session.inbox?.linkedPr
  return pr ? { text: `#${pr.number}`, state: pr.state ?? 'UNKNOWN' } : null
}

export function pullRequestColor(state: string, theme: TuiThemePalette): string {
  return state === 'OPEN' ? theme.cyan : state === 'MERGED' ? theme.green : theme.dim
}

/** What the selected rail row spends a second row on: branch, working-tree state and linked PR.
 * Read from the cache the composer already keeps warm for the selected session's directory —
 * never a spawn per row — and only mounted on the selected row. */
export const SessionRailDetail = React.memo(function SessionRailDetail({ session, theme, width, rowBg, accent }: {
  session: Session; theme: TuiThemePalette; width: number; rowBg: string; accent: string
}) {
  const cwd = typeof session.cwd === 'string' ? session.cwd : ''
  const git = useSyncExternalStore(subscribeGitSummary, () => (cwd ? peekGitSummaryCached(cwd) : null))
  const pr = pullRequestMark(session)
  const tree = git ? joinMeta([
    git.modified > 0 ? `${git.modified} modified` : null,
    git.untracked > 0 ? `${git.untracked} untracked` : null,
    git.modified === 0 && git.untracked === 0 ? 'clean' : null,
  ]) : null
  const text = joinMeta([git?.branch ?? null, tree, pr ? `PR ${pr.text} ${pr.state.toLowerCase()}` : null])
  if (!text) return null
  return (
    <box paddingX={1} flexDirection="row" backgroundColor={rowBg}>
      <text fg={accent} wrapMode="none" selectable={false}>▎</text>
      <text fg={theme.dim} wrapMode="none" selectable={false}>{fitText(text, width - 3)}</text>
    </box>
  )
})
