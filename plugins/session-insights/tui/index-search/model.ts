import type { PersistedSearchParams } from '../../../../lib/session-index/types'

export type SearchField = 'query' | 'provider' | 'date' | 'errors' | 'file'
export const SEARCH_FIELDS: readonly SearchField[] = ['query', 'provider', 'date', 'errors', 'file']

const DAY_MS = 86_400_000
export const DATE_FACETS = [
  { id: 'any', label: 'any time', ms: null },
  { id: 'day', label: 'last 24h', ms: DAY_MS },
  { id: 'week', label: 'last 7d', ms: 7 * DAY_MS },
  { id: 'month', label: 'last 30d', ms: 30 * DAY_MS },
] as const
export type DateFacetId = (typeof DATE_FACETS)[number]['id']
export const PROVIDER_FACETS = ['all', 'claude', 'codex', 'opencode', 'copilot', 'pi'] as const
export type ProviderFacet = (typeof PROVIDER_FACETS)[number]

export type SearchFacets = { query: string; provider: ProviderFacet; date: DateFacetId; hasError: boolean; touchedFile: string }
export const EMPTY_FACETS: SearchFacets = { query: '', provider: 'all', date: 'any', hasError: false, touchedFile: '' }

/** The index query for a facet state; null while there is no text to search for. */
export function searchParamsFor(facets: SearchFacets, now: number): PersistedSearchParams | null {
  const query = facets.query.trim()
  if (!query) return null
  const window = DATE_FACETS.find((entry) => entry.id === facets.date)?.ms ?? null
  return {
    query,
    limit: 25,
    ...(facets.provider !== 'all' ? { provider: facets.provider } : {}),
    ...(window != null ? { sinceMs: now - window } : {}),
    ...(facets.hasError ? { hasError: true } : {}),
    ...(facets.touchedFile.trim() ? { touchedFile: facets.touchedFile.trim() } : {}),
  }
}

export function cycle<T>(list: readonly T[], value: T, delta: number): T {
  const at = list.indexOf(value)
  return list[(Math.max(at, 0) + delta + list.length) % list.length]!
}

/** A text field's response to one key: the new value, or null when the key is not an edit. */
export function editText(value: string, key: { name: string; ctrl: boolean; meta?: boolean; sequence: string }): string | null {
  if (key.ctrl) return key.name === 'u' ? '' : key.name === 'w' ? value.replace(/\s*\S*\s*$/, '') : null
  if (key.meta) return null
  if (key.name === 'backspace' || key.name === 'delete') return Array.from(value).slice(0, -1).join('')
  // A cursor or function key arrives as an escape sequence; only a bracketed paste is text.
  if (key.sequence.startsWith('\u001b') && !key.sequence.startsWith('\u001b[200~')) return null
  // eslint-disable-next-line no-control-regex
  const text = key.sequence.replace(/\u001b\[20[01]~/g, '').replace(/[\u0000-\u001f\u007f]/g, '')
  return text ? (value + text).slice(0, 200) : null
}

/** Move to the next or previous field, wrapping. */
export function stepField(field: SearchField, delta: number): SearchField {
  return cycle(SEARCH_FIELDS, field, delta)
}

/** The facet on a toggle field changed by ←/→/space; null when `field` is a text field. */
export function changeFacet(facets: SearchFacets, field: SearchField, delta: number): SearchFacets | null {
  if (field === 'provider') return { ...facets, provider: cycle(PROVIDER_FACETS, facets.provider, delta) }
  if (field === 'date') return { ...facets, date: cycle(DATE_FACETS.map((entry) => entry.id), facets.date, delta) }
  if (field === 'errors') return { ...facets, hasError: !facets.hasError }
  return null
}
