const MULTI_TAG_PREFIX = 'mv-tags:'

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '')
}

export function normalizeSessionTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const tag of tags) {
    const value = normalizeTag(tag)
    if (!value) continue

    const dedupeKey = value.toLowerCase()
    if (seen.has(dedupeKey)) continue

    seen.add(dedupeKey)
    normalized.push(value)
  }

  return normalized
}

export function parseStoredSessionTags(rawTag?: string | null): string[] {
  const value = rawTag?.trim()
  if (!value) return []

  if (value.startsWith(MULTI_TAG_PREFIX)) {
    try {
      const parsed = JSON.parse(value.slice(MULTI_TAG_PREFIX.length))
      if (Array.isArray(parsed)) {
        return normalizeSessionTags(parsed.filter((tag): tag is string => typeof tag === 'string'))
      }
    } catch {
      return []
    }
  }

  return normalizeSessionTags([value])
}

export function parseSessionTagInput(input: string): string[] {
  return normalizeSessionTags(input.split(/\r?\n|,/))
}

export function serializeSessionTags(tags: string[]): string | null {
  const normalized = normalizeSessionTags(tags)

  if (normalized.length === 0) return null
  if (normalized.length === 1) return normalized[0]

  return `${MULTI_TAG_PREFIX}${JSON.stringify(normalized)}`
}

export function getPrimarySessionTag(rawTag?: string | null): string | null {
  return parseStoredSessionTags(rawTag)[0] ?? null
}
