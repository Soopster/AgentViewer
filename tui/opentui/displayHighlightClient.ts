import { getTreeSitterClient, TreeSitterClient } from '@opentui/core'
import { highlightDisplayCodeAsync } from './markdownBlocksWorkerClient'

/** Keep OpenTUI's native code layout, selection and stale-request handling.
 * Only display tokenization changes; editor buffers still use the real client. */
class DisplayHighlightClient extends TreeSitterClient {
  constructor() { super({ dataPath: '' }, { autoStartWorker: false }) }
  override async highlightOnce(content: string, filetype: string) {
    // Markdown captures also conceal syntax and render prose, so keep its
    // structural parser. Fenced children call this client with their language.
    if (!['markdown', 'markdown_inline'].includes(filetype)) {
      try {
        const highlights = await highlightDisplayCodeAsync(content, filetype)
        if (highlights !== null) return { highlights }
      } catch { /* Missing lexer/worker/Wasm uses the existing parser. */ }
    }
    return getTreeSitterClient().highlightOnce(content, filetype)
  }
}

export const displayHighlightClient = new DisplayHighlightClient()
