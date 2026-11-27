'use client'

// A pull request or issue link in transcript prose: a chip that wears the
// target's state once read, with a hover card saying what it is. Nothing is
// fetched until the pointer or keyboard focus reaches it — a long transcript can
// hold hundreds of links and each read is a `gh` spawn. A state, once read,
// is shared by every chip for the same URL.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, CircleDot, CircleSlash, GitCommitHorizontal, GitMerge, GitPullRequestArrow, GitPullRequestClosed, GitPullRequestDraft, Play, Tag } from 'lucide-react'
import { githubLinkLabel, parseGithubUrl, type GithubLink as ParsedLink } from '@/lib/github/links'
import type { GithubLinkPreview } from '@/lib/github/types'
import { readLinkPreview, useGithubRepo } from './repoContext'

const seen = new Map<string, GithubLinkPreview>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

function remember(url: string, preview: GithubLinkPreview) {
  seen.set(url, preview)
  if (seen.size > 300) seen.delete(seen.keys().next().value!)
  for (const listener of listeners) listener()
}

export function githubStateLook(kind: 'pr' | 'issue', state?: string, isDraft?: boolean) {
  if (kind === 'issue') {
    if (state === 'CLOSED') return { Icon: CircleCheck, color: 'var(--violet)', label: 'Closed' }
    return { Icon: CircleDot, color: state ? 'var(--green)' : 'var(--text-3)', label: 'Open' }
  }
  if (state === 'MERGED') return { Icon: GitMerge, color: 'var(--violet)', label: 'Merged' }
  if (state === 'CLOSED') return { Icon: GitPullRequestClosed, color: 'var(--red)', label: 'Closed' }
  if (isDraft) return { Icon: GitPullRequestDraft, color: 'var(--text-3)', label: 'Draft' }
  return { Icon: GitPullRequestArrow, color: state ? 'var(--green)' : 'var(--text-3)', label: 'Open' }
}

const KIND_ICONS = { commit: GitCommitHorizontal, run: Play, release: Tag, compare: GitCommitHorizontal, 'new-pr': GitPullRequestArrow } as const

const CHIP: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'baseline', padding: '0 6px', borderRadius: 999,
  border: '1px solid var(--border-2)', background: 'var(--surface-2)', color: 'var(--text)', textDecoration: 'none',
  fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.86em', lineHeight: 1.6, whiteSpace: 'nowrap', maxWidth: '100%',
}

function age(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1440)}d ago`
}

export function GithubChip({ link, label }: { link: ParsedLink; label?: string }) {
  const context = useGithubRepo()
  const preview = useSyncExternalStore(subscribe, () => seen.get(link.url), () => undefined)
  const [open, setOpen] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const [problem, setProblem] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readable = (link.kind === 'pr' || link.kind === 'issue') && !!context

  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => cancel, [])

  const show = (element: HTMLElement) => {
    if (!readable) return
    cancel()
    timer.current = setTimeout(() => {
      const box = element.getBoundingClientRect()
      const above = box.bottom + 180 > window.innerHeight
      setOpen({ left: Math.max(8, Math.min(box.left, window.innerWidth - 340)), top: above ? box.top - 6 : box.bottom + 6, above })
      readLinkPreview(context!.cwd, link.url).then(value => { setProblem(''); remember(link.url, value) }).catch((error: Error) => setProblem(error.message))
    }, 250)
  }
  const hide = () => { cancel(); setOpen(null) }

  const kind = preview?.kind ?? (link.kind === 'issue' ? 'issue' : 'pr')
  const stateful = link.kind === 'pr' || link.kind === 'issue'
  const look = githubStateLook(kind, preview?.state, preview?.isDraft)
  const Icon = stateful ? look.Icon : KIND_ICONS[link.kind as keyof typeof KIND_ICONS]
  const text = label ?? githubLinkLabel(link, context?.repo?.repo)

  return (
    <>
      <a
        href={link.url} target="_blank" rel="noreferrer" style={CHIP} data-github-link={link.kind}
        title={readable ? undefined : link.url}
        aria-label={preview ? `${look.label} ${kind === 'pr' ? 'pull request' : 'issue'} ${text}: ${preview.title}` : undefined}
        onMouseEnter={event => show(event.currentTarget)} onMouseLeave={hide}
        onFocus={event => show(event.currentTarget)} onBlur={hide}
      >
        <Icon aria-hidden size={12} style={{ color: stateful ? look.color : 'var(--text-3)', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
      </a>
      {/* Portalled: a virtualized row is transformed, which would make `fixed` mean "inside this row". */}
      {open ? createPortal(
        <span role="tooltip" style={{
          position: 'fixed', left: open.left, top: open.top, transform: open.above ? 'translateY(-100%)' : undefined, zIndex: 80, width: 320,
          display: 'block', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-2)', background: 'var(--surface)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, lineHeight: 1.5,
          color: 'var(--text-2)', whiteSpace: 'normal', textAlign: 'left', pointerEvents: 'none',
        }}>
          {preview ? (
            <>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text-3)', fontSize: 11 }}>
                <span>{preview.repo} #{preview.number}</span>
                <span style={{ color: look.color, display: 'inline-flex', gap: 4, alignItems: 'center' }}><look.Icon aria-hidden size={11} />{look.label}</span>
              </span>
              <span style={{ display: 'block', marginTop: 4, color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{preview.title}</span>
              <span style={{ display: 'block', marginTop: 6, color: 'var(--text-3)' }}>{preview.author} · opened {age(preview.createdAt)}</span>
              {preview.kind === 'pr' ? (
                <span style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                  <span style={{ color: 'var(--green)' }}>+{preview.additions}</span>
                  <span style={{ color: 'var(--red)' }}>−{preview.deletions}</span>
                  {preview.checks && preview.checks !== 'none' ? <span style={{ color: preview.checks === 'failure' ? 'var(--red)' : preview.checks === 'pending' ? 'var(--yellow)' : 'var(--green)' }}>checks {preview.checks === 'success' ? 'passed' : preview.checks === 'failure' ? 'failing' : 'running'}</span> : null}
                  {preview.reviewDecision ? <span>{preview.reviewDecision.toLowerCase().replace(/_/g, ' ')}</span> : null}
                </span>
              ) : null}
            </>
          ) : <span>{problem || 'Reading from GitHub…'}</span>}
        </span>, document.body,
      ) : null}
    </>
  )
}

const BARE = /^(?:https?:\/\/\S+|(?:[\w.-]+\/[\w.-]+)?#\d+|[0-9a-f]{7,40})$/

/**
 * The chip for an anchor in prose, or null to render it as written. A link the
 * author titled ("the fix") keeps their words; only a bare URL or reference
 * becomes a chip.
 */
export function githubAnchor(href: string | undefined, children: React.ReactNode): React.ReactElement | null {
  const link = href ? parseGithubUrl(href) : null
  if (!link) return null
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every(part => typeof part === 'string') ? children.join('') : null
  if (text === null || !BARE.test(text)) return null
  // A bare URL is shortened; a reference the author (or the autolinker) wrote keeps its text.
  return <GithubChip link={link} label={text.startsWith('http') ? undefined : text} />
}
