import { buildMarkdownBlocks } from './markdownBlocks'
import { markdownCodeChunks } from './markdownStructure'
import type { SimpleHighlight } from '@opentui/core'
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ id: number; content: string; kind?: 'code'; highlights?: SimpleHighlight[] }>) => void; postMessage: (response: unknown) => void }
scope.onmessage = ({ data }) => {
  try { scope.postMessage(data.kind === 'code' ? { id: data.id, chunks: markdownCodeChunks(data.content, 32, data.highlights) } : { id: data.id, blocks: buildMarkdownBlocks(data.content) }) }
  catch (error) { scope.postMessage({ id: data.id, error: String(error) }) }
}
