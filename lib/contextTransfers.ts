import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentProvider } from './types'

/**
 * Lineage between sessions: where a conversation (or the result of a task) was
 * carried from and to, and how. Forks, rewinds-by-fork, provider failover,
 * context handoffs and delegated results are all one relationship, so "where did
 * this session come from" has one answer instead of five. Taken from t3code's
 * orchestration-v2 `ContextTransfer`.
 *
 * Append-only JSONL, like the frecency table: a record is one `appendFileSync`
 * line, so a crash costs that line and not the history. A transfer is a fact
 * about the past and is never edited.
 */
export type ContextTransferType = 'fork' | 'rewind' | 'failover' | 'handoff' | 'delegation_result'

export type ContextTransferEnd = {
  provider?: AgentProvider | string
  sessionId: string
  /** Message or turn id the transfer was taken at, when it was not the end. */
  point?: string
}

export type ContextTransfer = {
  id: string
  type: ContextTransferType
  at: number
  source: ContextTransferEnd
  target: ContextTransferEnd
  /** `native` for the provider's own fork; otherwise the fallback strategy used. */
  strategy: string
  runId?: string
  taskId?: string
}

/** Beyond this, a read sees only the newest records; lineage browsing needs recent history, not an unbounded scan. */
const READ_TAIL_LINES = 5000

function file(): string {
  return path.join(process.cwd(), '.agent-viewer-data', 'context-transfers.jsonl')
}

export function recordContextTransfer(input: Omit<ContextTransfer, 'id' | 'at'> & { at?: number }): ContextTransfer {
  const transfer: ContextTransfer = { id: randomUUID(), at: input.at ?? Date.now(), ...input }
  // An end with no session id cannot be browsed from, so it is not a lineage edge.
  if (!transfer.source.sessionId || !transfer.target.sessionId) return transfer
  try {
    const target = file()
    mkdirSync(path.dirname(target), { recursive: true })
    appendFileSync(target, `${JSON.stringify(transfer)}\n`, { mode: 0o600 })
  } catch {
    // Lineage is a record of what happened, never a precondition for it.
  }
  return transfer
}

export function parseContextTransfers(text: string): ContextTransfer[] {
  const out: ContextTransfer[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as Partial<ContextTransfer>
      if (value.id && value.type && value.source?.sessionId && value.target?.sessionId) out.push(value as ContextTransfer)
    } catch {
      // A torn final write is skipped, not fatal.
    }
  }
  return out
}

/** Transfers touching `sessionId` (as source or target), oldest first. */
export function listContextTransfers(sessionId: string): ContextTransfer[] {
  const target = file()
  if (!existsSync(target)) return []
  const lines = readFileSync(target, 'utf8').split('\n')
  return parseContextTransfers(lines.slice(-READ_TAIL_LINES).join('\n'))
    .filter((transfer) => transfer.source.sessionId === sessionId || transfer.target.sessionId === sessionId)
}

/** Where `sessionId` came from, newest first: its ancestors by following target → source. */
export function sessionLineage(sessionId: string): ContextTransfer[] {
  const chain: ContextTransfer[] = []
  const seen = new Set<string>([sessionId])
  let current = sessionId
  for (let step = 0; step < 50; step += 1) {
    const parent = listContextTransfers(current)
      .filter((transfer) => transfer.target.sessionId === current)
      .at(-1)
    if (!parent || seen.has(parent.source.sessionId)) break
    chain.push(parent)
    seen.add(parent.source.sessionId)
    current = parent.source.sessionId
  }
  return chain
}
