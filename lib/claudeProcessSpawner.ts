import type {
  Options,
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import { spawn } from 'node:child_process'
import path from 'node:path'

export type ClaudeProcessSpawner = (options: SpawnOptions) => SpawnedProcess

type Registry = { spawner: ClaudeProcessSpawner | null }

export type ClaudeSshSpawnerConfig = {
  host: string
  user?: string
  port?: number
  identityFile?: string
  knownHostsFile?: string
  remoteCommand: string
  localRoot?: string
  remoteRoot?: string
  forwardSecrets?: boolean
}

export type ClaudeProcessTransportStatus = {
  kind: 'local' | 'registered' | 'ssh'
  target?: string
  healthy: boolean
  active: number
  lastStartedAt?: string
  lastExitedAt?: string
  lastExitCode?: number | null
  lastError?: string
}

function registry(): Registry {
  const root = globalThis as typeof globalThis & { __agentViewerClaudeProcessSpawner?: Registry }
  return root.__agentViewerClaudeProcessSpawner ??= { spawner: null }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerClaudeTransportStatus: ClaudeProcessTransportStatus | undefined
}

function transportStatus(): ClaudeProcessTransportStatus {
  return globalThis.__agentViewerClaudeTransportStatus
    ?? (globalThis.__agentViewerClaudeTransportStatus = { kind: 'local', healthy: true, active: 0 })
}

function shellQuote(value: string): string {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) throw new Error('SSH command values may not contain control characters')
  return `'${value.replaceAll("'", "'\\''")}'`
}

function mappedRemoteCwd(cwd: string | undefined, config: ClaudeSshSpawnerConfig): string | undefined {
  if (!cwd) return undefined
  if (!config.localRoot || !config.remoteRoot) return config.remoteRoot
  const relative = path.relative(config.localRoot, cwd)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Claude SSH cwd is outside AGENT_VIEWER_CLAUDE_SSH_LOCAL_ROOT')
  return path.posix.join(config.remoteRoot.replaceAll('\\', '/'), relative.replaceAll('\\', '/'))
}

const SAFE_REMOTE_ENV = /^(CLAUDE_|ANTHROPIC_)/
const SECRET_REMOTE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i

export function buildClaudeSshInvocation(options: SpawnOptions, config: ClaudeSshSpawnerConfig): { args: string[]; target: string; command: string } {
  const host = config.host.trim()
  const remoteCommand = config.remoteCommand.trim()
  if (!host || host.startsWith('-') || /[\s\0]/.test(host)) throw new Error('Invalid Claude SSH host')
  if (!remoteCommand) throw new Error('AGENT_VIEWER_CLAUDE_SSH_COMMAND is required')
  const target = config.user ? `${config.user}@${host}` : host
  if (config.user && (!/^[A-Za-z0-9._-]+$/.test(config.user) || config.user.startsWith('-'))) throw new Error('Invalid Claude SSH user')
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=yes',
  ]
  if (config.port) args.push('-p', String(config.port))
  if (config.identityFile) args.push('-i', config.identityFile)
  if (config.knownHostsFile) args.push('-o', `UserKnownHostsFile=${config.knownHostsFile}`)
  const env = Object.entries(options.env).filter(([name, value]) => (
    value !== undefined
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    && SAFE_REMOTE_ENV.test(name)
    && (config.forwardSecrets || !SECRET_REMOTE_ENV.test(name))
  ))
  const commandParts = [
    ...(mappedRemoteCwd(options.cwd, config) ? ['cd', '--', mappedRemoteCwd(options.cwd, config)!, '&&'] : []),
    'env',
    ...env.map(([name, value]) => `${name}=${value}`),
    remoteCommand,
    ...options.args,
  ]
  const command = commandParts.map((part) => part === '&&' ? part : shellQuote(part)).join(' ')
  args.push(target, command)
  return { args, target, command }
}

export function createClaudeSshProcessSpawner(config: ClaudeSshSpawnerConfig): ClaudeProcessSpawner {
  return (options) => {
    const invocation = buildClaudeSshInvocation(options, config)
    const status = transportStatus()
    Object.assign(status, {
      kind: 'ssh' as const,
      target: invocation.target,
      healthy: true,
      active: status.active + 1,
      lastStartedAt: new Date().toISOString(),
      lastError: undefined,
    })
    const child = spawn('ssh', invocation.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: options.signal,
    })
    child.stderr?.on('data', () => { /* drain SSH diagnostics; exit/error state is reported below */ })
    child.once('error', (error) => {
      status.healthy = false
      status.lastError = error.message.slice(0, 500)
    })
    child.once('exit', (code) => {
      status.active = Math.max(0, status.active - 1)
      status.lastExitedAt = new Date().toISOString()
      status.lastExitCode = code
      status.healthy = code === 0 || status.active > 0
      if (code !== 0 && !status.lastError) status.lastError = `SSH worker exited with code ${code ?? 'signal'}`
    })
    return child
  }
}

function sshConfigFromEnv(): ClaudeSshSpawnerConfig | undefined {
  const host = process.env.AGENT_VIEWER_CLAUDE_SSH_HOST?.trim()
  if (!host) return undefined
  const remoteCommand = process.env.AGENT_VIEWER_CLAUDE_SSH_COMMAND?.trim()
  if (!remoteCommand) throw new Error('AGENT_VIEWER_CLAUDE_SSH_COMMAND is required when AGENT_VIEWER_CLAUDE_SSH_HOST is set')
  const rawPort = process.env.AGENT_VIEWER_CLAUDE_SSH_PORT
  const port = rawPort ? Number(rawPort) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('AGENT_VIEWER_CLAUDE_SSH_PORT must be 1-65535')
  return {
    host,
    user: process.env.AGENT_VIEWER_CLAUDE_SSH_USER,
    port,
    identityFile: process.env.AGENT_VIEWER_CLAUDE_SSH_IDENTITY_FILE,
    knownHostsFile: process.env.AGENT_VIEWER_CLAUDE_SSH_KNOWN_HOSTS_FILE,
    remoteCommand,
    localRoot: process.env.AGENT_VIEWER_CLAUDE_SSH_LOCAL_ROOT,
    remoteRoot: process.env.AGENT_VIEWER_CLAUDE_SSH_REMOTE_ROOT,
    forwardSecrets: process.env.AGENT_VIEWER_CLAUDE_SSH_FORWARD_SECRETS === '1',
  }
}

export function claudeProcessTransportStatus(): ClaudeProcessTransportStatus {
  const status = transportStatus()
  if (registry().spawner) return { ...status, kind: 'registered' }
  const ssh = sshConfigFromEnv()
  if (ssh && status.kind !== 'ssh') return { ...status, kind: 'ssh', target: ssh.user ? `${ssh.user}@${ssh.host}` : ssh.host }
  return { ...status }
}

function assertSpawnedProcess(process: SpawnedProcess): SpawnedProcess {
  if (!process || !process.stdin || typeof process.stdin.write !== 'function'
    || !process.stdout || typeof process.stdout.on !== 'function'
    || !('killed' in process) || !('exitCode' in process)
    || typeof process.kill !== 'function'
    || typeof process.on !== 'function'
    || typeof process.once !== 'function'
    || typeof process.off !== 'function') {
    throw new Error('Claude process spawner must return the full SDK SpawnedProcess contract')
  }
  return process
}

/**
 * Install a process transport before creating Claude queries.
 *
 * The adapter owns the execution location (local wrapper, container, or VM)
 * and must return live stdin/stdout streams plus exit/error lifecycle methods.
 * It must forward SpawnOptions.signal to its transport: the SDK only aborts
 * that signal after its stdin-EOF grace period, preserving graceful shutdown.
 * Explicit registrations take precedence over the opt-in SSH transport
 * configured by AGENT_VIEWER_CLAUDE_SSH_* environment variables.
 */
export function registerClaudeProcessSpawner(spawner: ClaudeProcessSpawner): () => void {
  if (typeof spawner !== 'function') throw new Error('Claude process spawner must be a function')
  const state = registry()
  state.spawner = spawner
  return () => {
    if (state.spawner === spawner) state.spawner = null
  }
}

export function claudeProcessSpawnOptions(): Pick<Options, 'spawnClaudeCodeProcess'> {
  const spawner = registry().spawner ?? (sshConfigFromEnv() ? createClaudeSshProcessSpawner(sshConfigFromEnv()!) : null)
  if (!spawner) return {}
  return {
    spawnClaudeCodeProcess: (options) => assertSpawnedProcess(spawner(options)),
  }
}
