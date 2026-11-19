export type WindowAttention = {
  versions: Partial<Record<'metadata' | 'transcript', string>>
  errorVersion: string | null
  unread: boolean
  error: boolean
}

export function observeWindowAttention(previous: WindowAttention | undefined, source: 'metadata' | 'transcript', version: string, errorVersion: string | null, focused: boolean): WindowAttention {
  const changed = previous?.versions[source] !== undefined && previous.versions[source] !== version
  const unread = !focused && Boolean(previous?.unread || changed)
  const nextErrorVersion = source === 'transcript' ? errorVersion : previous?.errorVersion ?? null
  const error = !focused && Boolean(previous?.error || (nextErrorVersion && nextErrorVersion !== previous?.errorVersion))
  if (previous && previous.versions[source] === version && previous.errorVersion === nextErrorVersion && previous.unread === unread && previous.error === error) return previous
  return { versions: { ...previous?.versions, [source]: version }, errorVersion: nextErrorVersion, unread, error }
}

export function readWindowAttention(previous: WindowAttention): WindowAttention {
  return previous.unread || previous.error ? { ...previous, unread: false, error: false } : previous
}

export function windowAttentionBadge(input: { unread?: boolean; error?: boolean; needsInput?: boolean }, compact = false): string | null {
  const badges = [input.needsInput ? (compact ? '?' : '? input') : null, input.error ? (compact ? '!' : '! error') : null, input.unread ? (compact ? '●' : '● unread') : null].filter(Boolean)
  return badges.length ? badges.join(' · ') : null
}

/** Walk layout order, wrapping once and preferring a different window. */
export function nextWindowNeedingAttention(order: string[], current: string | null, needsAttention: (key: string) => boolean): string | null {
  const start = order.indexOf(current ?? '')
  for (let step = 1; step <= order.length; step += 1) {
    const key = order[(start + step) % order.length]!
    if (needsAttention(key)) return key
  }
  return null
}
