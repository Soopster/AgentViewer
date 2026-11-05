import { buildMarkdownBlocks } from './markdownBlocks'
import { markdownCodeChunks } from './markdownStructure'
import { highlightCode } from '../../lib/codeHighlight'
import type { SimpleHighlight } from '@opentui/core'
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ id: number; content: string; kind?: 'code' | 'highlight'; language?: string; highlights?: SimpleHighlight[] }>) => void; postMessage: (response: unknown) => void }
scope.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'highlight') {
      const result = await highlightCode(data.content, data.language ?? '')
      const captures: SimpleHighlight[] | null = result ? [] : null
      for (const line of result?.lines ?? []) for (const token of line) {
        if (token.scope && token.scope !== 'foreground') captures!.push([token.offset, token.offset + token.content.length, token.scope])
      }
      scope.postMessage({ id: data.id, captures })
    } else scope.postMessage(data.kind === 'code' ? { id: data.id, chunks: markdownCodeChunks(data.content, 32, data.highlights) } : { id: data.id, blocks: buildMarkdownBlocks(data.content) })
  } catch (error) { scope.postMessage({ id: data.id, error: String(error) }) }
}
