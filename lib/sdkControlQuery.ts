import { query, type Query } from '@anthropic-ai/claude-agent-sdk'

async function* emptyPrompt() {}

export function createSessionControlQuery(sessionId: string, model = 'claude-sonnet-4-6'): Query {
  return query({
    prompt: emptyPrompt(),
    options: {
      resume: sessionId,
      model,
      maxTurns: 0,
      enableFileCheckpointing: true,
    },
  })
}
