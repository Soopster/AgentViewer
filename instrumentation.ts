export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startup } = await import('@anthropic-ai/claude-agent-sdk')
    await startup()
  } catch (err) {
    console.warn('[instrumentation] Claude SDK startup() failed:', err)
  }
}
