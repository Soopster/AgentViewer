import { sessionIdentityKey } from './sessionIdentity'
import type { Session } from '../../lib/types'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { TuiDensity } from '../theme'
import { transcriptPayloadBytes } from './transcriptPayloadSize'
import type { SessionCacheBudget } from './sessionCacheBudget'

type Entry = { owner: string; detail: TuiSessionDetail; revision: number | undefined; bytes: number; readAt: number }
type Read = (session: Session, density: TuiDensity, tools: boolean) => Promise<TuiSessionDetail>
const identity = sessionIdentityKey
const variant = (session: Session, density: TuiDensity, tools: boolean) => JSON.stringify([identity(session), density, tools])
export type TranscriptObserver = {
  session: Session
  density: TuiDensity
  tools: boolean
  /** Read current metadata without subscribing the window to the whole list. */
  revision: () => number | undefined
  active: () => boolean
  priority: () => number
  shouldYield: () => boolean
  onDetail: (detail: TuiSessionDetail) => void
  onError: (error: unknown) => void
}
type Watch = { observers: Set<TranscriptObserver>; due: number; loading: boolean; release: () => void }

/** Workspace payload owner and refresh broker. One scheduled read per variant,
 * irrespective of the number of views. Only visible views acquire observers.
 * Entry and byte limits apply to warm data; visible data is pinned until release.
 */
export class TranscriptSessionLoader {
  private entries = new Map<string, Entry>()
  private flights = new Map<string, { owner: string; revision: number | undefined; promise: Promise<TuiSessionDetail>; token: object }>()
  private watches = new Map<string, Watch>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private retainedBytes = 0
  private running = false
  constructor(private fetch: Read, private capacity = 8, private byteBudget = 64 * 1024 * 1024, private interval = 2500, private retain: (session: Session) => () => void = () => () => {}, private budget?: SessionCacheBudget) { budget?.register(this) }
  peek(session: Session, density: TuiDensity, tools: boolean): Entry | undefined {
    const key = variant(session, density, tools)
    const entry = this.entries.get(key)
    if (entry) { this.entries.delete(key); this.entries.set(key, entry) }
    return entry
  }
  read(session: Session, density: TuiDensity, tools: boolean, revision: number | undefined): Promise<TuiSessionDetail> {
    const key = variant(session, density, tools)
    const current = this.flights.get(key)
    if (current && current.revision === revision) return current.promise
    const token = {}
    const promise = Promise.resolve().then(() => this.fetch(session, density, tools)).then(detail => {
      if (this.flights.get(key)?.token === token) {
        this.drop(key)
        const entry = { owner: identity(session), detail, revision, bytes: detail.estimatedRetainedBytes ?? transcriptPayloadBytes(detail), readAt: Date.now() }
        this.entries.set(key, entry)
        this.retainedBytes += entry.bytes
        this.budget?.touch(entry.owner, entry.bytes)
        this.trim()
        this.budget?.trim()
        for (const observer of this.watches.get(key)?.observers ?? []) observer.onDetail(detail)
      }
      return detail
    }).finally(() => {
      if (this.flights.get(key)?.token === token) this.flights.delete(key)
    })
    this.flights.set(key, { owner: identity(session), revision, promise, token })
    return promise
  }
  /** Subscribe once on mount/resume; release when hidden. No per-window timer. */
  observe(observer: TranscriptObserver): () => void {
    const key = variant(observer.session, observer.density, observer.tools)
    let watch = this.watches.get(key)
    if (!watch) this.watches.set(key, watch = { observers: new Set(), due: 0, loading: false, release: this.retain(observer.session) })
    watch.observers.add(observer)
    const cached = this.peek(observer.session, observer.density, observer.tools)
    if (cached) observer.onDetail(cached.detail)
    this.schedule()
    return () => {
      watch!.observers.delete(observer)
      if (!watch!.observers.size && this.watches.get(key) === watch) { this.watches.delete(key); watch!.release() }
      this.trim()
      this.schedule()
    }
  }
  evictSession(owner: string) {
    for (const [key, entry] of this.entries) if (entry.owner === owner) this.drop(key)
  }
  invalidate(session: Session) {
    const owner = identity(session)
    for (const [key, entry] of this.entries) if (entry.owner === owner) this.drop(key)
    for (const [key, flight] of this.flights) if (flight.owner === owner) this.flights.delete(key)
    for (const watch of this.watches.values()) if ([...watch.observers].some(observer => identity(observer.session) === owner)) watch.due = 0
    this.schedule()
  }
  /** Observable accounting for diagnostics and acceptance checks. */
  get stats() { return { entries: this.entries.size, estimatedBytes: this.retainedBytes, pinned: this.watches.size, pending: this.flights.size, timer: this.timer !== undefined } }
  private drop(key: string) {
    const old = this.entries.get(key)
    if (old) { this.retainedBytes -= old.bytes; this.entries.delete(key) }
  }
  private trim() {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.capacity && this.retainedBytes <= this.byteBudget) break
      if (!this.watches.has(key)) this.drop(key)
    }
  }
  private schedule() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.running || !this.watches.size) return
    const due = Math.min(...[...this.watches.values()].map(watch => watch.due))
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick() }, Math.max(0, due - Date.now()))
    this.timer.unref?.()
  }
  private async tick() {
    this.running = true
    try {
      // Choose due foreground work first. Re-evaluate after each async read so
      // a new foreground observer jumps ahead of queued background refreshes.
      while (true) {
        const now = Date.now()
        const due = [...this.watches.entries()].filter(([, watch]) => !watch.loading && watch.due <= now)
        const priority = (watch: Watch) => Math.min(...[...watch.observers].map(observer => observer.priority()))
        due.sort((a, b) => priority(a[1]) - priority(b[1]))
        const next = due[0]
        if (!next) break
        const [key, watch] = next
        const observers = [...watch.observers].sort((a, b) => a.priority() - b.priority())
        const observer = observers.find(item => !item.shouldYield())
        if (!observer) { watch.due = now + 300; continue }
        const revisions = observers.map(item => item.revision()).filter((value): value is number => value !== undefined)
        const revision = revisions.length ? Math.max(...revisions) : undefined
        const cached = this.entries.get(key)
        const changed = !cached || revision === undefined || cached.revision === undefined || revision > cached.revision
        const refreshing = observers.some(item => item.active())
        const oldEnough = !cached || now - cached.readAt >= this.interval
        watch.due = now + this.interval
        if (!changed && !refreshing || cached && !oldEnough && (revision === undefined || revision === cached.revision)) continue
        watch.loading = true
        try { await this.read(observer.session, observer.density, observer.tools, revision) }
        catch (error) { for (const item of watch.observers) item.onError(error) }
        finally { watch.loading = false; watch.due = Date.now() + this.interval }
      }
    } finally { this.running = false; this.schedule() }
  }
}
