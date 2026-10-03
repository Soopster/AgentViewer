#!/usr/bin/env node
/**
 * ACP (Agent Client Protocol) stdio entrypoint — the ACP counterpart to
 * bin/agent-viewer-ahp.ts. Unlike AHP (TCP/WebSocket by default, stdio as a
 * fallback), ACP's transports.mdx says clients and agents "SHOULD support
 * stdio whenever possible" and stdio is the only stable transport today, so
 * this only speaks stdio: the client (Zed, or any ACP-compatible editor)
 * launches this process and talks newline-delimited JSON-RPC over its
 * stdin/stdout, exactly per the spec's stdio transport section.
 *
 * One process serves exactly one provider — see lib/acpAgent.ts's module doc
 * comment for why. Select it with --provider, or default to whichever
 * provider is currently active in this agentViewer install.
 */
import { Readable, Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { createAcpAgentApp } from '../lib/acpAgent'
import { isAgentProvider } from '../lib/provider'
import { getConfiguredProvider } from '../lib/providerState'

async function resolveProviderArg(): Promise<Parameters<typeof createAcpAgentApp>[0]> {
  const flagIndex = process.argv.findIndex((arg) => arg === '--provider' || arg.startsWith('--provider='))
  if (flagIndex >= 0) {
    const raw = process.argv[flagIndex].startsWith('--provider=')
      ? process.argv[flagIndex].slice('--provider='.length)
      : process.argv[flagIndex + 1]
    if (!isAgentProvider(raw)) {
      throw new Error(`--provider must be one of claude, codex, opencode, copilot, pi (got ${JSON.stringify(raw)})`)
    }
    return raw
  }
  const configured = await getConfiguredProvider()
  return configured === 'all' ? 'claude' : configured
}

async function main() {
  const provider = await resolveProviderArg()
  const app = createAcpAgentApp(provider)
  const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
  console.error(`Agent Viewer ACP agent (${provider}) ready on stdio`)
  const connection = app.connect(stream)
  process.once('SIGINT', () => connection.close())
  process.once('SIGTERM', () => connection.close())
  await connection.closed
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
