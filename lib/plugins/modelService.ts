// A one-shot, tool-less model question for plugin and mod server code. It is the
// same shape as the model-list read (lib/sdkControlQuery.ts): nothing is persisted,
// no tool or MCP server runs, no setting source is loaded, and an approval prompt
// would be denied rather than parked, so a plugin cannot use it to act — only to ask.

export type ModelAskInput = { readonly system: string; readonly prompt: string; readonly signal?: AbortSignal; readonly model?: string }
export type ModelAsk = (input: ModelAskInput) => Promise<string>
export const MODEL_ASK_MAX_CHARS = 60_000

/** The default: Claude, through the agent SDK, with every capability off. */
export const askModel: ModelAsk = async ({ system, prompt, signal, model }) => {
  if (prompt.length > MODEL_ASK_MAX_CHARS) throw new Error('the request is too large for a one-shot question')
  const [{ query }, { claudeProcessSpawnOptions }] = await Promise.all([import('@anthropic-ai/claude-agent-sdk'), import('../claudeProcessSpawner')])
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const stream = query({
    prompt,
    options: {
      systemPrompt: system,
      tools: [],
      maxTurns: 1,
      persistSession: false,
      permissionPrompts: 'none',
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      abortController: controller,
      ...(model ? { model } : {}),
      ...claudeProcessSpawnOptions(),
    },
  })
  let text = ''
  try {
    for await (const message of stream) {
      if (message.type === 'assistant') {
        const content = (message.message as { content?: unknown }).content
        if (Array.isArray(content)) for (const block of content) if ((block as { type?: string }).type === 'text') text += String((block as { text?: unknown }).text ?? '')
      } else if (message.type === 'result') {
        if ((message as { is_error?: boolean }).is_error) throw new Error(String((message as { result?: unknown }).result ?? 'the model reported an error').slice(0, 300))
        break
      }
    }
  } finally { signal?.removeEventListener('abort', abort); stream.close?.() }
  return text.trim().slice(0, MODEL_ASK_MAX_CHARS)
}
