import type { SessionMessage } from '../../lib/types'

// The prompts `/rewind` can return to, newest first. Only what the user typed
// counts: tool results carry no text, and `!command` rows, local-command
// output and injected context all arrive as tagged user rows.
export type RewindCandidate = { uuid: string; text: string }

const INJECTED_USER_ROW = /^<(bash-input|bash-stdout|bash-stderr|local-command|command-name|command-message|task-notification|system-reminder)/

function promptText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string' ? [(block as { text: string }).text] : []))
    .join('\n\n')
    .trim()
}

function isMainChain(message: SessionMessage): boolean {
  return message.parent_tool_use_id == null
}

export function rewindCandidates(raw: readonly SessionMessage[]): RewindCandidate[] {
  const out: RewindCandidate[] = []
  for (const message of raw) {
    if (message.type !== 'user' || !isMainChain(message)) continue
    const text = promptText((message.message as { content?: unknown }).content)
    if (!text || INJECTED_USER_ROW.test(text)) continue
    out.push({ uuid: message.uuid, text })
  }
  return out.reverse()
}

// Claude forks inclusive of a message id, so rewinding to before a prompt forks
// at the main-chain message preceding it. null: the prompt opened the
// conversation, and returning before it is a fresh session.
export function claudeForkPoint(raw: readonly SessionMessage[], uuid: string): string | null | undefined {
  const index = raw.findIndex((message) => message.uuid === uuid)
  if (index === -1) return undefined
  for (let i = index - 1; i >= 0; i -= 1) {
    if (isMainChain(raw[i]!)) return raw[i]!.uuid
  }
  return null
}
