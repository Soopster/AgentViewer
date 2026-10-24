import { getTreeSitterClient, infoStringToFiletype } from '@opentui/core'
import { partitionMarkdownCodeAsync } from './markdownBlocksWorkerClient'
import { MarkdownCodeQueue } from './markdownCodeQueue'

const queue = new MarkdownCodeQueue(async (content, language) => {
  const filetype = infoStringToFiletype(language)
  if (!filetype) return []
  try { return (await getTreeSitterClient().highlightOnce(content, filetype)).highlights ?? [] }
  catch { return [] }
}, partitionMarkdownCodeAsync)

/** Styles stay native-scene-local. Only serializable source captures cross the
 * parser/partition worker boundary, and only mounted slices become StyledText. */
export const prepareMarkdownCode = queue.read.bind(queue)
