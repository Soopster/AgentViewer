// The pull request a session produced: the newest one its transcript shows being
// opened. Reading it from the transcript (not from the branch) means it is the
// one this conversation made, whichever surface asks. No Node imports.
import type { ThreadedMessage, ToolThread } from '../threading'
import { detectGithubActivities, type GithubActivity } from './activity'
import { parseGithubUrl } from './links'

export type SessionPullRequest = { repo: string; number: number; url: string }

const SHELLISH = /^(bash|shell|exec_command|run_terminal_cmd)$/i

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('\n')
}

const cache = new WeakMap<ToolThread, SessionPullRequest | null>()

function createdBy(thread: ToolThread): SessionPullRequest | null {
  if (!thread.result || thread.result.is_error) return null
  const known = cache.get(thread)
  if (known !== undefined) return known
  const name = SHELLISH.test(thread.toolUse.name) ? 'Bash' : thread.toolUse.name
  const input = thread.toolUse.input as Record<string, unknown>
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : undefined
  const activities: GithubActivity[] = name === 'Bash' && !command?.includes('gh ')
    ? []
    : detectGithubActivities(name, command === undefined ? input : { ...input, command }, resultText(thread.result.content))
  let found: SessionPullRequest | null = null
  for (const activity of activities) {
    if (activity.kind !== 'pr-create' || activity.failed || !activity.url) continue
    const link = parseGithubUrl(activity.url)
    if (link?.kind === 'pr') found = { repo: link.repo, number: link.number!, url: link.url }
  }
  cache.set(thread, found)
  return found
}

export function findSessionPullRequest(messages: readonly ThreadedMessage[]): SessionPullRequest | null {
  for (let at = messages.length - 1; at >= 0; at--) {
    const blocks = messages[at]!.blocks
    for (let block = blocks.length - 1; block >= 0; block--) {
      const entry = blocks[block]!
      if (entry.type !== 'tool_thread') continue
      const found = createdBy(entry)
      if (found) return found
    }
  }
  return null
}
