import type { Query } from '@anthropic-ai/claude-agent-sdk'

const runningQueries = new Map<string, Query>()

export function setRunningQuery(sessionId: string, query: Query): void {
  runningQueries.set(sessionId, query)
}

export function getRunningQuery(sessionId: string): Query | undefined {
  return runningQueries.get(sessionId)
}

export function clearRunningQuery(sessionId: string, query?: Query): void {
  if (!query) {
    runningQueries.delete(sessionId)
    return
  }

  const current = runningQueries.get(sessionId)
  if (current === query) runningQueries.delete(sessionId)
}
