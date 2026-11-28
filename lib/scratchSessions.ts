import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'

/**
 * Scratch chats run in their own empty directory instead of a repository, so a
 * question never touches (or is filed under) a project. The directories are
 * kept: the session stays resumable, like any other.
 *
 * Not `isScratchSession` (lib/sessionSidebarModel.ts), which hides probe-like
 * prompts. A scratch chat is real conversation and must stay visible.
 */
function scratchRoot(): string {
  return path.join(process.cwd(), '.agent-viewer-data', 'scratch')
}

/** Make a fresh directory for one scratch chat. */
export async function createScratchDir(): Promise<string> {
  const root = scratchRoot()
  await mkdir(root, { recursive: true })
  return mkdtemp(path.join(root, 'chat-'))
}

export { isScratchDir, SCRATCH_PROJECT_LABEL } from './scratchPaths'
