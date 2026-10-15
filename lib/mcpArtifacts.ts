import type { McpResourceLink, ToolResultBlock } from './types'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Preserve non-browser resource URIs too: users can copy them into their MCP client. */
export function mcpResourceLinks(...sources: unknown[]): McpResourceLink[] {
  const links = new Map<string, McpResourceLink>()
  for (const source of sources) {
    if (!Array.isArray(source)) continue
    for (const value of source) {
      const item = record(value)
      if (item?.type !== 'resource_link' || typeof item.uri !== 'string' || !item.uri.trim()) continue
      if (item.uri.length > 8192 || /[\u0000-\u001f\u007f]/.test(item.uri)) continue
      if (links.size >= 50 && !links.has(item.uri)) continue
      links.set(item.uri, {
        type: 'resource_link', uri: item.uri,
        name: typeof item.name === 'string' ? item.name : item.uri,
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
        ...(typeof item.size === 'number' && Number.isFinite(item.size) && item.size >= 0 ? { size: item.size } : {}),
      })
    }
  }
  return [...links.values()]
}

export function mcpArtifactHref(uri: string): string | undefined {
  // Never make javascript:, data:, file:, or server-local custom URIs navigable.
  try {
    const url = new URL(uri)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href
  } catch { /* Preserve the URI as plain text. */ }
  return undefined
}

/** A sidecar belongs to the SDK message's single tool result, never every result in a batch. */
export function attachMcpResultSidecar(results: ToolResultBlock[], value: unknown): ToolResultBlock[] {
  const sidecar = record(value)
  return results.map(result => {
    const ownLinks = mcpResourceLinks(result.resourceLinks, Array.isArray(result.content) ? result.content : [])
    if (!sidecar || results.length !== 1) return ownLinks.length ? { ...result, resourceLinks: ownLinks } : result
    const links = mcpResourceLinks(ownLinks, sidecar.resourceLinks)
    return {
      ...result,
      ...(links.length ? { resourceLinks: links } : {}),
      ...(Object.hasOwn(sidecar, 'structuredContent') ? { structuredContent: sidecar.structuredContent } : {}),
      ...(record(sidecar._meta) ? { mcpMeta: record(sidecar._meta) } : {}),
    }
  })
}

export function mcpAppResourceUri(meta: unknown): string | undefined {
  const value = record(meta)
  const uri = record(value?.ui)?.resourceUri ?? value?.['ui/resourceUri']
  return typeof uri === 'string' && uri.startsWith('ui://') && uri.length <= 8192
    && !/[\u0000-\u001f\u007f]/.test(uri) ? uri : undefined
}

export function mcpAppHtml(resource: { contents: { uri: string; mimeType?: string; text?: string; blob?: string }[] }, uri: string): string {
  const item = resource.contents.find(item => item.uri === uri && item.mimeType?.split(';')[0].trim() === 'text/html')
  let html = item?.text
  if (html === undefined && item?.blob) {
    if (item.blob.length > 2_700_000) throw new Error('This MCP App is too large to preview.')
    html = new TextDecoder().decode(Uint8Array.from(atob(item.blob), char => char.charCodeAt(0)))
  }
  if (!html) throw new Error('This MCP App did not return an HTML preview.')
  if (html.length > 2_000_000) throw new Error('This MCP App is too large to preview.')
  // The preview has no same-origin privileges, network access, forms, or popups.
  // Prepending a policy means a later document policy can only restrict it further.
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">${html}`
}
