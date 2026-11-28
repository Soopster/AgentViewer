import { manifest } from './manifest'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { externalCardUrl, scrubCardText, type CardBlock } from '../../lib/plugins/cardBlocks'

type Source = { url: string; title: string; excerpt: string }

const record = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const text = (value: unknown, max: number) => typeof value === 'string' ? scrubCardText(value, max).trim() : ''

function sources(value: unknown, depth = 0): Source[] {
  if (depth > 4 || !value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.slice(0, 12).flatMap(item => sources(item, depth + 1)).slice(0, 12)
  const row = record(value)
  const url = externalCardUrl(row.url)
  if (url && !row.error) return [{ url, title: text(row.title, 120) || new URL(url).hostname, excerpt: text(row.snippet ?? row.excerpt ?? row.content, 400) }]
  for (const field of ['queries', 'results', 'urls', 'sources']) {
    if (Array.isArray(row[field])) return sources(row[field], depth + 1)
  }
  return []
}

function textSources(value: string): Source[] {
  const rows: Source[] = []
  let title = ''
  for (const line of value.split('\n')) {
    const inline = /^\s*(?:[-*]\s+|\d+\.\s+)?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i.exec(line)
    const heading = /^\s*(?:#{1,6}\s+|Title:\s*|\d+\.\s+)(.+)/i.exec(line)
    const url = externalCardUrl(inline?.[2] ?? /^\s*(?:URL|Link|Source):\s*(https?:\/\/\S+)\s*$/i.exec(line)?.[1])
    if (url) {
      rows.push({ url, title: text(inline?.[1] ?? title, 120) || new URL(url).hostname, excerpt: '' })
      title = ''
    } else if (heading) {
      title = heading[1] ?? ''
    } else if (rows.length && line.trim() && !rows.at(-1)!.excerpt) {
      rows.at(-1)!.excerpt = text(line, 400)
    }
    if (rows.length >= 12) break
  }
  return rows
}

export const behavior: PluginBehaviorModule = {
  apiVersion: manifest.apiVersion,
  pluginId: manifest.id,
  toolCard({ target, tool, result }) {
    if (!result || result.isError) return
    const search = target.provider === 'pi' ? tool.name === 'web_search' : target.provider === 'opencode' && tool.name === 'websearch'
    const fetch = target.provider === 'pi' ? tool.name === 'fetch_content' : target.provider === 'opencode' && tool.name === 'webfetch'
    if (!search && !fetch) return

    const structured = sources(result.structured ?? result.json)
    const rows = structured.length ? structured : textSources(result.text)
    const requestedUrl = target.provider === 'opencode' && fetch ? externalCardUrl(tool.input.url) : undefined
    if (!rows.length && requestedUrl && result.text.trim()) {
      rows.push({ url: requestedUrl, title: new URL(requestedUrl).hostname, excerpt: text(result.text, 400) })
    }
    const unique = [...new Map(rows.map(row => [row.url, row])).values()].slice(0, 10)
    if (!unique.length) return
    const blocks: CardBlock[] = unique.flatMap(row => [
      { type: 'link', label: row.title, url: row.url } as const,
      ...(row.excerpt ? [{ type: 'text', text: row.excerpt } as const] : []),
    ])
    return { title: search ? 'Web search' : 'Web fetch', lines: [`${unique.length} ${unique.length === 1 ? 'source' : 'sources'} · ${unique[0]!.title}`], blocks }
  },
}
