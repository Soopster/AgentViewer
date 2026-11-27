// The linked pull request's live state for the terminal. Reading it spawns `gh`,
// so one feed per pull request serves every window showing it, runs only while
// one is shown, and notifies only when something a person would see changed —
// a poll that finds nothing new must not repaint anything.
import { useCallback, useSyncExternalStore } from 'react'
import { githubRepoArgument } from '../../lib/github/links'
import type { GithubPrDetail } from '../../lib/github/types'
import { summarizePrStatus } from '../../lib/github/prWork'
import { readTuiGithubPr } from '../../lib/tui/github'
import type { LinkedPullRequest } from '../../lib/types'

const PENDING_POLL_MS = 30_000
const IDLE_POLL_MS = 120_000
/** Long enough that scrubbing past sessions in the rail spawns nothing. */
const FIRST_READ_DELAY_MS = 700

export type SessionPrState = { detail: GithubPrDetail | null; error: string }

type Feed = { state: SessionPrState; fingerprint: string; listeners: Set<() => void>; timer: ReturnType<typeof setTimeout> | null; cwd: string; pr: LinkedPullRequest }

const EMPTY: SessionPrState = { detail: null, error: '' }
const MAX_FEEDS = 32
const feeds = new Map<string, Feed>()
let reader = readTuiGithubPr

/** Smokes replace `gh` with their own reader. */
export function setSessionPrReader(next: typeof readTuiGithubPr | null): void {
  reader = next ?? readTuiGithubPr
  feeds.clear()
}

const keyOf = (cwd: string, pr: LinkedPullRequest) => `${cwd}\u0000${pr.url || `${pr.repo}#${pr.number}`}`

function publish(feed: Feed, state: SessionPrState) {
  const fingerprint = state.detail ? `${state.detail.title}|${state.detail.state}|${JSON.stringify(summarizePrStatus(state.detail))}|${state.detail.mergeable}|${state.error}` : state.error
  if (fingerprint === feed.fingerprint) { feed.state.detail = state.detail ?? feed.state.detail; return }
  feed.fingerprint = fingerprint
  feed.state = state
  for (const listener of feed.listeners) listener()
}

async function read(feed: Feed): Promise<void> {
  try {
    publish(feed, { detail: await reader(feed.cwd, feed.pr.number, githubRepoArgument(feed.pr.url, feed.pr.repo)), error: '' })
  } catch (error) {
    // The last good read stays on screen; the error says why it may be old.
    publish(feed, { detail: feed.state.detail, error: error instanceof Error ? error.message : String(error) })
  }
}

function schedule(feed: Feed, delay: number): void {
  feed.timer = setTimeout(async () => {
    await read(feed)
    if (!feed.listeners.size) return
    const detail = feed.state.detail
    if (detail && detail.state !== 'OPEN') { feed.timer = null; return }
    schedule(feed, detail?.checkRuns.some(check => check.state === 'pending') ? PENDING_POLL_MS : IDLE_POLL_MS)
  }, delay)
}

export function subscribeSessionPr(cwd: string, pr: LinkedPullRequest, listener: () => void): () => void {
  const key = keyOf(cwd, pr)
  let feed = feeds.get(key)
  if (!feed) {
    feed = { state: EMPTY, fingerprint: '', listeners: new Set(), timer: null, cwd, pr }
    feeds.set(key, feed)
    for (const [other, entry] of feeds) {
      if (feeds.size <= MAX_FEEDS) break
      if (!entry.listeners.size) feeds.delete(other)
    }
  }
  feed.listeners.add(listener)
  if (!feed.timer) schedule(feed, FIRST_READ_DELAY_MS)
  return () => {
    feed.listeners.delete(listener)
    if (!feed.listeners.size && feed.timer) { clearTimeout(feed.timer); feed.timer = null }
  }
}

export function peekSessionPr(cwd: string, pr: LinkedPullRequest | undefined): SessionPrState {
  return pr ? feeds.get(keyOf(cwd, pr))?.state ?? EMPTY : EMPTY
}

/** Read again now, after an action changed the pull request. */
export function refreshSessionPr(cwd: string, pr: LinkedPullRequest): void {
  const feed = feeds.get(keyOf(cwd, pr))
  if (!feed?.listeners.size) return
  if (feed.timer) clearTimeout(feed.timer)
  schedule(feed, 0)
}

export function useSessionPr(cwd: string, pr: LinkedPullRequest | undefined): SessionPrState {
  const url = pr?.url
  const number = pr?.number
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a listing hands out a new object for the same pull request
  const subscribe = useCallback((listener: () => void) => pr && cwd ? subscribeSessionPr(cwd, pr, listener) : () => {}, [cwd, url, number])
  return useSyncExternalStore(subscribe, () => peekSessionPr(cwd, pr))
}
