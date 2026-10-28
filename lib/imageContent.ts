import type { ImageBlock } from './types'

/** Normalize inline image bytes without fetching URLs or reading local files. */
export function inlineImageBlock(value: unknown): ImageBlock | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (item.type !== 'image' && item.type !== 'blob' && item.type !== 'resource' && item.type !== 'file') return null
  const source = (item.source && typeof item.source === 'object' ? item.source : {}) as Record<string, unknown>
  const file = (item.file && typeof item.file === 'object' ? item.file : {}) as Record<string, unknown>
  const resource = (item.resource && typeof item.resource === 'object' ? item.resource : {}) as Record<string, unknown>
  const mime = source.media_type ?? item.mimeType ?? item.mime_type ?? file.type ?? resource.mimeType
  const data = source.data ?? item.data ?? file.base64 ?? resource.blob
  if (typeof mime !== 'string' || !mime.startsWith('image/') || typeof data !== 'string' || !data) return null
  return { type: 'image', source: { type: 'base64', media_type: mime, data } }
}
