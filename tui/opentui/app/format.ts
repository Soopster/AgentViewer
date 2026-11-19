export function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
export function formatCopilotTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}
export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}
export function formatModelChipValue(value: string): string {
  try {
    const parsed = JSON.parse(value) as { modelID?: unknown; modelId?: unknown; id?: unknown} 
    for (const candidate of [parsed.modelID, parsed.modelId, parsed.id]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  } catch {
    // Plain provider model id.
  }
  return value.split('/').pop() || value
}
export function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.max(Math.round(ms / 60000), 0)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}
