import {
  CopilotClient,
  approveAll,
  type CopilotClientOptions,
  type CopilotSession,
  type ResumeSessionConfig,
} from '@github/copilot-sdk'

function normalizedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function wrapCopilotError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : 'Unknown Copilot error'
  if (/ENOENT|spawn|not found|@github\/copilot/i.test(detail)) {
    return new Error(
      `Failed to start GitHub Copilot. Install/configure the Copilot CLI or set COPILOT_CLI_URL/COPILOT_CLI_PATH. ${detail}`,
    )
  }
  return new Error(`GitHub Copilot provider unavailable. ${detail}`)
}

function createClientOptions(): CopilotClientOptions {
  const cliUrl = normalizedEnv(process.env.COPILOT_CLI_URL)
  const cliPath = normalizedEnv(process.env.COPILOT_CLI_PATH)
  const options: CopilotClientOptions = {
    autoStart: true,
    logLevel: 'error',
  }

  if (cliUrl) {
    options.cliUrl = cliUrl
  } else {
    options.useStdio = true
  }

  if (cliPath) {
    options.cliPath = cliPath
  }

  return options
}

let clientPromise: Promise<CopilotClient> | null = null

async function createClient(): Promise<CopilotClient> {
  const client = new CopilotClient(createClientOptions())
  try {
    await client.start()
    return client
  } catch (error) {
    await client.forceStop().catch(() => {})
    throw wrapCopilotError(error)
  }
}

export async function getCopilotClient(): Promise<CopilotClient> {
  clientPromise ??= createClient().catch((error) => {
    clientPromise = null
    throw error
  })
  return clientPromise
}

export async function resumeCopilotSession(
  sessionId: string,
  overrides: Partial<ResumeSessionConfig> = {},
): Promise<CopilotSession> {
  const client = await getCopilotClient()
  try {
    return await client.resumeSession(sessionId, {
      onPermissionRequest: approveAll,
      disableResume: true,
      ...overrides,
    })
  } catch (error) {
    throw wrapCopilotError(error)
  }
}
