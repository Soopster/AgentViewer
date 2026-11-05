// One-shot structured model calls made by the viewer itself (coach insights,
// goal audits, session recaps) — never inside a user's session. Tool-less,
// single-turn and not persisted, so a call leaves nothing in any session store.

export type StructuredQueryResult = {
  text: string
  structuredOutput?: unknown
}

export async function runStructuredQuery(input: {
  prompt: string
  schema: Record<string, unknown>
  model: string
  signal: AbortSignal
}): Promise<StructuredQueryResult> {
  // Loaded on demand: the SDK and pool are send-path weight that a process
  // making no such call should not pay for.
  const [{ query }, { CLAUDE_QUERY_ENV }, { claudeProcessSpawnOptions }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk'),
    import('./claudePool'),
    import('./claudeProcessSpawner'),
  ])
  const abortController = new AbortController()
  const onAbort = () => abortController.abort()
  if (input.signal.aborted) abortController.abort()
  input.signal.addEventListener('abort', onAbort)
  try {
    const q = query({
      prompt: input.prompt,
      options: {
        env: CLAUDE_QUERY_ENV,
        model: input.model,
        maxTurns: 1,
        persistSession: false,
        // No tools — the model only ever sees the text we hand it.
        allowedTools: [],
        permissionMode: 'default',
        abortController,
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
        outputFormat: { type: 'json_schema', schema: input.schema },
        ...claudeProcessSpawnOptions(),
      },
    })
    let text = ''
    let structuredOutput: unknown
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') text += block.text
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
          text = msg.result
        }
        if (msg.subtype === 'success' && msg.structured_output !== undefined) {
          structuredOutput = msg.structured_output
        }
        break
      }
    }
    return { text, structuredOutput }
  } finally {
    input.signal.removeEventListener('abort', onAbort)
  }
}

/** The first JSON object in a model's text reply, or null. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}
