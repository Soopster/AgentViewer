/** Coordinates eviction of every representation of a session in one process.
 * Stores accounting only. Visible leases pin source baselines; warm sessions
 * compete for a byte budget rather than each cache independently retaining N.
 */
export class SessionCacheBudget {
  private sizes = new Map<string, number>()
  private owners = new Set<WeakRef<{ evictSession(key: string): void }>>()
  private pins = new Map<string, number>()
  constructor(private limit: number) {}
  register(owner: { evictSession(key: string): void }) {
    for (const reference of this.owners) if (!reference.deref()) this.owners.delete(reference)
    this.owners.add(new WeakRef(owner))
  }
  touch(key: string, bytes: number) {
    this.sizes.delete(key)
    this.sizes.set(key, Number.isFinite(bytes) ? Math.max(0, bytes) : 0)
  }
  retain(key: string) { this.pins.set(key, (this.pins.get(key) ?? 0) + 1) }
  release(key: string) { const count = (this.pins.get(key) ?? 0) - 1; if (count > 0) this.pins.set(key, count); else this.pins.delete(key) }
  isPinned(key: string) { return this.pins.has(key) }
  forget(key: string) { this.sizes.delete(key) }
  get bytes() { return [...this.sizes.values()].reduce((sum, bytes) => sum + bytes, 0) }
  evictSession(key: string) {
    this.sizes.delete(key)
    for (const reference of this.owners) {
      const owner = reference.deref()
      if (owner) owner.evictSession(key)
      else this.owners.delete(reference)
    }
  }
  trim(evict: (key: string) => void = () => {}) {
    let bytes = this.bytes
    for (const [key, size] of this.sizes) {
      if (bytes <= this.limit) break
      if (this.isPinned(key)) continue
      bytes -= size
      this.evictSession(key)
      evict(key)
    }
  }
}

/** Shared by the main-thread delivery layer, workspace loaders and view caches. */
export const mainTranscriptBudget = new SessionCacheBudget(128 * 1024 * 1024)
