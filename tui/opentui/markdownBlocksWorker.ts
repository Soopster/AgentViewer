import { buildMarkdownBlocks } from './markdownBlocks'
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ id: number; content: string }>) => void; postMessage: (response: unknown) => void }
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ id: data.id, blocks: buildMarkdownBlocks(data.content) }) }
  catch (error) { scope.postMessage({ id: data.id, error: String(error) }) }
}
