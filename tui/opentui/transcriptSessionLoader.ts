import type { Session } from '../../lib/types'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { TuiDensity } from '../theme'

type Entry = { owner: string; detail: TuiSessionDetail; revision: number | undefined }
type Read = (session: Session, density: TuiDensity, tools: boolean) => Promise<TuiSessionDetail>
const identity = (session: Session) => `${session.provider ?? 'claude'}:${session.sessionId}`
const variant = (session: Session, density: TuiDensity, tools: boolean) => JSON.stringify([identity(session), density, tools])

/** Workspace-local payloads. Pollers decide freshness; this service shares ownership and concurrent reads. */
export class TranscriptSessionLoader {
  private entries = new Map<string, Entry>()
  private flights = new Map<string, { owner: string; revision: number | undefined; promise: Promise<TuiSessionDetail>; token: object }>()
  constructor(private fetch: Read, private capacity = 8) {}
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
        this.entries.delete(key)
        this.entries.set(key, { owner: identity(session), detail, revision })
        while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!)
      }
      return detail
    }).finally(() => {
      if (this.flights.get(key)?.token === token) this.flights.delete(key)
    })
    this.flights.set(key, { owner: identity(session), revision, promise, token })
    return promise
  }
  invalidate(session: Session) {
    const owner = identity(session)
    for (const [key, entry] of this.entries) if (entry.owner === owner) this.entries.delete(key)
    for (const [key, flight] of this.flights) if (flight.owner === owner) this.flights.delete(key)
  }
}
