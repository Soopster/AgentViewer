'use client'

// Which checkout a transcript is about, so a `#12` in it can be linked and a
// link's pull request can be read. Provided by the transcript's host; absent
// (an export, a preview) means links render as ordinary links.
import { createContext, use, useEffect, useMemo, useState } from 'react'
import remarkGfm from 'remark-gfm'
import type { PluggableList } from 'unified'
import { remarkGithubReferences } from '@/lib/github/autolink'
import type { GithubLinkPreview, GithubRepoRef } from '@/lib/github/types'

type GithubRepoValue = { cwd: string; repo: GithubRepoRef | null }

const GithubRepoContext = createContext<GithubRepoValue | null>(null)

const repoReads = new Map<string, Promise<GithubRepoRef | null>>()
const previewReads = new Map<string, { at: number; read: Promise<GithubLinkPreview> }>()
const PREVIEW_TTL_MS = 60_000
const MAX_PREVIEWS = 200

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

function readRepo(cwd: string): Promise<GithubRepoRef | null> {
  let read = repoReads.get(cwd)
  if (!read) {
    read = getJson<{ repo: GithubRepoRef | null }>(`/api/github/link?cwd=${encodeURIComponent(cwd)}`)
      .then(body => body.repo)
      .catch(() => { repoReads.delete(cwd); return null })
    repoReads.set(cwd, read)
  }
  return read
}

export function readLinkPreview(cwd: string, url: string): Promise<GithubLinkPreview> {
  const key = `${cwd}\u0000${url}`
  const known = previewReads.get(key)
  if (known && Date.now() - known.at < PREVIEW_TTL_MS) return known.read
  const read = getJson<{ preview: GithubLinkPreview }>(`/api/github/link?cwd=${encodeURIComponent(cwd)}&url=${encodeURIComponent(url)}`).then(body => body.preview)
  previewReads.set(key, { at: Date.now(), read })
  read.catch(() => previewReads.delete(key))
  while (previewReads.size > MAX_PREVIEWS) previewReads.delete(previewReads.keys().next().value!)
  return read
}

export function GithubRepoProvider({ cwd, children }: { cwd?: string | null; children: React.ReactNode }) {
  const [resolved, setResolved] = useState<{ cwd: string; repo: GithubRepoRef | null } | null>(null)
  useEffect(() => {
    if (!cwd) return
    let live = true
    void readRepo(cwd).then(repo => { if (live) setResolved({ cwd, repo }) })
    return () => { live = false }
  }, [cwd])
  const repo = resolved && resolved.cwd === cwd ? resolved.repo : null
  const value = useMemo(() => cwd ? { cwd, repo } : null, [cwd, repo])
  return <GithubRepoContext.Provider value={value}>{children}</GithubRepoContext.Provider>
}

export function useGithubRepo(): GithubRepoValue | null {
  return use(GithubRepoContext)
}

const PLAIN: PluggableList = [remarkGfm]
const perRepo = new WeakMap<GithubRepoRef, PluggableList>()

/** The transcript's remark plugins: GFM, plus reference autolinks once the repository is known. */
export function useTranscriptRemarkPlugins(): PluggableList {
  const repo = use(GithubRepoContext)?.repo
  if (!repo) return PLAIN
  let plugins = perRepo.get(repo)
  if (!plugins) perRepo.set(repo, plugins = [remarkGfm, remarkGithubReferences(repo)])
  return plugins
}
