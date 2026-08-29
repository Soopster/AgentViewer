'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, GitBranch, LoaderCircle, Search, X } from 'lucide-react'
import type { GitBranchRef, GitSummary } from '@/lib/gitProvider'

type Props = {
  cwd: string
  currentBranch: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSwitched: (summary: GitSummary) => void
}

export default function BranchSwitcher({ cwd, currentBranch, open, onOpenChange, onSwitched }: Props) {
  const [branches, setBranches] = useState<GitBranchRef[]>([])
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setQuery('')
    setActiveIndex(0)
    void fetch(`/api/git?action=branches&cwd=${encodeURIComponent(cwd)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as { branches?: GitBranchRef[]; error?: string }
        if (!response.ok || !body.branches) throw new Error(body.error ?? 'Unable to load branches')
        setBranches(body.branches)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load branches')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [cwd, open])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || shellRef.current?.contains(event.target)) return
      if (event.target instanceof Element && event.target.closest('[data-branch-switcher-trigger="true"]')) return
      onOpenChange(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onOpenChange, open])

  const filteredBranches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return branches
    return branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
  }, [branches, query])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(filteredBranches.length - 1, 0)))
  }, [filteredBranches.length])

  const switchBranch = async (branch: GitBranchRef) => {
    if (branch.current || branch.name === currentBranch) {
      onOpenChange(false)
      return
    }
    if (branch.worktreePath) {
      setError(`${branch.name} is already checked out in ${branch.worktreePath}`)
      return
    }

    setSwitchingBranch(branch.name)
    setError(null)
    try {
      const response = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd, action: 'switch', branch: branch.name }),
      })
      const body = await response.json() as { summary?: GitSummary | null; error?: string }
      if (!response.ok || !body.summary) throw new Error(body.error ?? `Unable to switch to ${branch.name}`)
      onSwitched(body.summary)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to switch to ${branch.name}`)
    } finally {
      setSwitchingBranch(null)
    }
  }

  if (!open) return null

  return (
    <div ref={shellRef} className="av-web-branch-switcher" role="dialog" aria-label="Switch Git branch">
      <div className="av-web-branch-switcher-search">
        <Search aria-hidden size={16} />
        <input
          autoFocus
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveIndex((current) => Math.min(current + 1, filteredBranches.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveIndex((current) => Math.max(current - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const branch = filteredBranches[activeIndex]
              if (branch) void switchBranch(branch)
            }
          }}
          placeholder="Search branches…"
          aria-label="Search branches"
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear branch search">
            <X aria-hidden size={14} />
          </button>
        ) : null}
      </div>
      <div className="av-web-branch-switcher-list" role="listbox" aria-label="Local branches">
        {loading ? (
          <div className="av-web-branch-switcher-empty"><LoaderCircle className="av-spin" size={15} /> Loading branches…</div>
        ) : filteredBranches.length === 0 ? (
          <div className="av-web-branch-switcher-empty">No matching local branches</div>
        ) : filteredBranches.map((branch, index) => {
          const occupiedElsewhere = Boolean(branch.worktreePath && !branch.current)
          return (
            <button
              key={branch.name}
              type="button"
              role="option"
              aria-selected={branch.current}
              data-active={index === activeIndex ? 'true' : 'false'}
              disabled={switchingBranch !== null || occupiedElsewhere}
              title={occupiedElsewhere ? `Checked out in ${branch.worktreePath}` : branch.name}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => { void switchBranch(branch) }}
            >
              <GitBranch aria-hidden size={14} />
              <span className="av-web-branch-switcher-name">{branch.name}</span>
              {switchingBranch === branch.name ? <LoaderCircle className="av-spin" aria-label="Switching" size={14} /> : null}
              {branch.current ? <span className="av-web-branch-switcher-badge"><Check aria-hidden size={11} /> current</span> : null}
              {occupiedElsewhere ? <span className="av-web-branch-switcher-badge">worktree</span> : null}
            </button>
          )
        })}
      </div>
      {error ? <div className="av-web-branch-switcher-error" role="alert">{error}</div> : null}
      <div className="av-web-branch-switcher-hint">↑↓ navigate · enter switch · esc close</div>
    </div>
  )
}
