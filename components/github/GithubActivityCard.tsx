'use client'

// A tool call that changed or read something on GitHub, drawn as what happened
// ("Opened pull request #12") instead of as the command that did it. The command
// and its raw output stay one click away: this is a reading of them, never a
// replacement.
import { useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { ArrowUpFromLine, CircleCheck, CircleDashed, CircleDot, CircleX, GitCommitHorizontal, GitMerge, GitPullRequestArrow, GitPullRequestClosed, GitPullRequestDraft, ListChecks, MessageSquare, Play, Search, Tag, TriangleAlert, UserCheck, type LucideIcon } from 'lucide-react'
import type { GithubActivity, GithubActivityKind, GithubActivityTone, GithubCheckRow } from '@/lib/github/activity'
import { parseGithubUrl } from '@/lib/github/links'
import { githubAnchor, GithubChip } from './GithubLink'
import { useGithubRepo, useTranscriptRemarkPlugins } from './repoContext'

const MONO = "'IBM Plex Mono', monospace"
export const GITHUB_TONE_COLORS: Record<GithubActivityTone, string> = {
  success: 'var(--green)', danger: 'var(--red)', warning: 'var(--yellow)', merged: 'var(--violet)', info: 'var(--cyan)',
}

const ICONS: Partial<Record<GithubActivityKind, LucideIcon>> = {
  'pr-create': GitPullRequestArrow, 'pr-merge': GitMerge, 'pr-close': GitPullRequestClosed, 'pr-draft': GitPullRequestDraft,
  'pr-checks': ListChecks, 'pr-comment': MessageSquare, 'issue-comment': MessageSquare, 'pr-review': UserCheck,
  'issue-create': CircleDot, 'issue-view': CircleDot, 'issue-list': CircleDot, 'issue-close': CircleCheck, 'issue-reopen': CircleDot, 'issue-edit': CircleDot,
  'run-list': Play, 'run-view': Play, 'run-watch': Play, 'run-rerun': Play, 'run-cancel': Play, 'workflow-run': Play,
  'release-create': Tag, 'release-view': Tag, search: Search, commit: GitCommitHorizontal, push: ArrowUpFromLine,
}

export function githubActivityIcon(activity: GithubActivity): LucideIcon {
  if (activity.failed) return TriangleAlert
  return ICONS[activity.kind] ?? GitPullRequestArrow
}

const CHECK_ICONS: Record<GithubCheckRow['state'], { Icon: LucideIcon; color: string }> = {
  success: { Icon: CircleCheck, color: 'var(--green)' }, failure: { Icon: CircleX, color: 'var(--red)' },
  pending: { Icon: CircleDot, color: 'var(--yellow)' }, neutral: { Icon: CircleDashed, color: 'var(--text-3)' },
}
const CHECK_ORDER: GithubCheckRow['state'][] = ['failure', 'pending', 'success', 'neutral']
const SHOWN_ROWS = 8

function MoreButton({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-3)', fontFamily: MONO, fontSize: 11, textAlign: 'left' }}>+ {hidden} more</button>
}

function Checks({ checks }: { checks: GithubCheckRow[] }) {
  const [all, setAll] = useState(false)
  const sorted = [...checks].sort((a, b) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state))
  const shown = all ? sorted : sorted.slice(0, SHOWN_ROWS)
  return (
    <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
      {shown.map((check, index) => {
        const { Icon, color } = CHECK_ICONS[check.state]
        return (
          <div key={`${check.name}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, fontFamily: MONO, fontSize: 12 }}>
            <Icon aria-label={check.state} size={13} style={{ color, flexShrink: 0 }} />
            {check.url
              ? <a href={check.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{check.name}</a>
              : <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{check.name}</span>}
            {check.duration ? <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{check.duration}</span> : null}
          </div>
        )
      })}
      {sorted.length > shown.length ? <MoreButton hidden={sorted.length - shown.length} onClick={() => setAll(true)} /> : null}
    </div>
  )
}

function Rows({ activity }: { activity: GithubActivity }) {
  const [all, setAll] = useState(false)
  const repo = useGithubRepo()?.repo
  const rows = activity.rows ?? []
  const shown = all ? rows : rows.slice(0, SHOWN_ROWS)
  const base = activity.repo ? `https://github.com/${activity.repo}` : repo ? `https://${repo.host}/${repo.repo}` : null
  return (
    <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
      {shown.map((row, index) => {
        const url = row.url ?? (base && row.number ? `${base}/${activity.kind === 'issue-list' ? 'issues' : 'pull'}/${row.number}` : null)
        const link = url ? parseGithubUrl(url) : null
        return (
          <div key={`${row.number ?? row.title}-${index}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, fontSize: 12 }}>
            {link ? <GithubChip link={link} label={row.number ? `#${row.number}` : undefined} /> : row.number ? <span style={{ fontFamily: MONO, color: 'var(--text-3)' }}>#{row.number}</span> : null}
            <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
            {row.meta ? <span style={{ color: 'var(--text-3)', fontFamily: MONO, fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{row.meta}</span> : null}
          </div>
        )
      })}
      {rows.length > shown.length ? <MoreButton hidden={rows.length - shown.length} onClick={() => setAll(true)} /> : null}
    </div>
  )
}

const heading = ({ children }: { children?: ReactNode }) => <div style={{ fontWeight: 600, color: 'var(--text)', margin: '4px 0 2px' }}>{children}</div>
/** A comment or description as it will read on GitHub, at card scale. */
const BODY_COMPONENTS: Components = {
  h1: heading, h2: heading, h3: heading, h4: heading,
  p: ({ children }) => <p style={{ margin: '0 0 4px' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: '0 0 4px', paddingLeft: 18, listStyle: 'disc' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 4px', paddingLeft: 18, listStyle: 'decimal' }}>{children}</ol>,
  pre: ({ children }) => <pre style={{ margin: '0 0 4px', overflow: 'auto', fontFamily: MONO, fontSize: 11.5 }}>{children}</pre>,
  code: ({ children }) => <code style={{ fontFamily: MONO, fontSize: 11.5 }}>{children}</code>,
  a: ({ href, children }) => githubAnchor(href, children) ?? <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--violet)' }}>{children}</a>,
  // A description may embed images from anywhere; the card names them instead of loading them.
  img: ({ alt }) => <span style={{ color: 'var(--text-3)' }}>[image{alt ? `: ${alt}` : ''}]</span>,
}

function Body({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const remarkPlugins = useTranscriptRemarkPlugins()
  const long = text.length > 240 || text.split('\n').length > 4
  return (
    <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--border-2)', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
      <div style={long && !open ? { maxHeight: 80, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 55%, transparent)' } : undefined}>
        <ReactMarkdown remarkPlugins={remarkPlugins} components={BODY_COMPONENTS}>{text}</ReactMarkdown>
      </div>
      {long ? <button type="button" onClick={() => setOpen(value => !value)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-3)', fontFamily: MONO, fontSize: 11 }}>{open ? 'show less' : 'show all'}</button> : null}
    </div>
  )
}

function ActivityRow({ activity }: { activity: GithubActivity }) {
  const context = useGithubRepo()
  const color = GITHUB_TONE_COLORS[activity.tone]
  const Icon = githubActivityIcon(activity)
  const link = activity.url ? parseGithubUrl(activity.url) : null
  const here = context?.repo?.repo.toLowerCase()
  const number = activity.number ? `${activity.repo && here && activity.repo.toLowerCase() !== here ? activity.repo : ''}#${activity.number}` : ''
  // A number with no URL of its own can still be linked when the repository is known.
  const repoBase = activity.repo ? `https://github.com/${activity.repo}` : context?.repo ? `https://${context.repo.host}/${context.repo.repo}` : null
  const numbered = link?.number === activity.number && activity.number ? link
    : activity.number && repoBase ? parseGithubUrl(`${repoBase}/${activity.kind.startsWith('issue') ? 'issues' : 'pull'}/${activity.number}`) : null
  const commit = activity.sha && repoBase ? parseGithubUrl(`${repoBase}/commit/${activity.sha}`) : null
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 14px', minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, flexShrink: 0, color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
        <Icon aria-hidden size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minHeight: 24, lineHeight: '24px' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: activity.failed ? color : 'var(--text)' }}>{activity.verb}</span>
          {numbered ? <GithubChip link={numbered} label={number} /> : number ? <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-2)' }}>{number}</span> : null}
          {commit && activity.kind === 'commit' ? <GithubChip link={commit} label={activity.sha!.slice(0, 7)} /> : activity.sha ? <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-3)' }}>{activity.sha.slice(0, 7)}</span> : null}
          {activity.subject ? <span style={{ fontSize: 13, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '0 1 auto', maxWidth: '100%' }}>{activity.subject}</span> : null}
          {link && link.number === undefined && link.kind !== 'commit' ? <GithubChip link={link} label={link.kind === 'new-pr' ? 'Open a pull request' : undefined} /> : null}
        </div>
        {activity.facts.length ? <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)', overflowWrap: 'anywhere' }}>{activity.facts.join(' · ')}</div> : null}
        {activity.checks?.length ? <Checks checks={activity.checks} /> : null}
        {activity.rows?.length ? <Rows activity={activity} /> : null}
        {activity.body ? <Body text={activity.body} /> : null}
      </div>
    </div>
  )
}

export function GithubActivityCard({ activities, pending, children }: { activities: GithubActivity[]; pending: boolean; children: ReactNode }) {
  const [raw, setRaw] = useState(false)
  const worst = activities.find(activity => activity.tone === 'danger') ?? activities[activities.length - 1]!
  const accent = pending ? 'var(--border-2)' : GITHUB_TONE_COLORS[worst.tone]
  return (
    <div data-github-activity={activities.map(activity => activity.kind).join(' ')} style={{ marginTop: 4 }}>
      <div style={{ border: '1px solid var(--border)', borderLeft: `2px solid ${accent}`, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)' }}>
        {activities.map((activity, index) => (
          <div key={index} style={index ? { borderTop: '1px solid var(--border)' } : undefined}><ActivityRow activity={activity} /></div>
        ))}
        <button
          type="button" onClick={() => setRaw(value => !value)} aria-expanded={raw}
          style={{ display: 'block', width: '100%', textAlign: 'right', padding: '2px 12px 3px', border: 0, borderTop: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontFamily: MONO, fontSize: 10.5 }}
        >
          {raw ? '▲ hide command & output' : '▼ command & output'}
        </button>
      </div>
      {raw ? children : null}
    </div>
  )
}
