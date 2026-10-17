import type { FilePart } from '@opencode-ai/sdk'
import type { ImageBlock, McpResourceLink, ToolResultBlock } from './types'
import { mcpArtifactHref, mcpResourceLinks } from './mcpArtifacts'

export function openCodeAttachmentImage(file: Pick<FilePart, 'url' | 'mime'>): ImageBlock | null {
  // Only preview supported inline bitmap data. Remote and local files stay
  // links; transcript rendering must not fetch server-local paths or URLs.
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(file.url)
  if (!match || match[1]!.toLowerCase() !== file.mime.toLowerCase()) return null
  return { type: 'image', source: { type: 'base64', media_type: match[1]!.toLowerCase(), data: match[2]! } }
}

type AttachmentFile = Pick<FilePart, 'url' | 'mime' | 'filename'>

export function openCodeAttachmentLinks(files: AttachmentFile[]): McpResourceLink[] {
  return mcpResourceLinks(files.filter(file => !file.url.startsWith('data:')).map(file => ({
    type: 'resource_link', uri: file.url, name: file.filename || file.url, mimeType: file.mime,
  })))
}

export function withOpenCodeAttachments(result: ToolResultBlock, attachments: unknown): ToolResultBlock {
  const files = (Array.isArray(attachments) ? attachments : []).flatMap((value): AttachmentFile[] => {
    if (!value || typeof value !== 'object' || typeof value.url !== 'string' || typeof value.mime !== 'string') return []
    return [{ url: value.url, mime: value.mime, ...(typeof value.filename === 'string' ? { filename: value.filename } : {}) }]
  })
  if (!files.length) return result
  const images = files.flatMap(file => { const image = openCodeAttachmentImage(file); return image ? [image] : [] })
  const links = openCodeAttachmentLinks(files)
  return { ...result,
    content: images.length ? [...(typeof result.content === 'string' ? [{ type: 'text' as const, text: result.content }] : result.content), ...images] : result.content,
    ...(links.length ? { resourceLinks: links } : {}),
  }
}

export function openCodeAttachmentText(file: Pick<FilePart, 'url' | 'filename'>): string {
  const name = file.filename || (file.url.startsWith('data:') ? 'Inline attachment' : file.url)
  const href = mcpArtifactHref(file.url)
  // Text remains useful in plain transcripts; web/terminal markdown can open
  // HTTP links, while server-local paths remain copyable text.
  const label = name.replace(/[\\[\]]/g, '\\$&')
  return href ? `[file] [${label}](${href.replace(/[()]/g, char => char === '(' ? '%28' : '%29')})` : `[file] ${name}`
}
