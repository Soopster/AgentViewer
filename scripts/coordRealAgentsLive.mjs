// Live check: real agent CLIs (Codex, Copilot, OpenCode) join a Coordinator run
// through the stdio MCP bridge, claim a task, do it and complete it — with no
// `provider` argument, so the roster must still name each one correctly.
//
//   COORD_LIVE_ORIGIN=http://127.0.0.1:3000 COORD_LIVE_AGENTS=codex,copilot,opencode npm run coord:agents:live
//
// Spends a few cents of model usage per agent. Each agent writes down any tool
// result it found confusing; anything but NONE fails the check, because
// that is the agent telling us the tools got in its way.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridge = path.join(repo, 'bin', 'agent-viewer-mcp.mjs')
const origin = process.env.COORD_LIVE_ORIGIN ?? 'http://127.0.0.1:3000'
const agents = (process.env.COORD_LIVE_AGENTS ?? 'codex,copilot,opencode').split(',').map(s => s.trim()).filter(Boolean)
const node = process.execPath
// spawnSync moves the child but leaves PWD naming this shell's directory, and
// OpenCode takes its project from PWD: without this it worked in the wrong repo.

const cwd = mkdtempSync(path.join(tmpdir(), 'coord-agents-live-'))
execFileSync('git', ['init', '-q', cwd])
writeFileSync(path.join(cwd, 'README.md'), 'fixture\n')
execFileSync('git', ['-C', cwd, 'add', '.'])
execFileSync('git', ['-C', cwd, '-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const coord = (...args) => JSON.parse(execFileSync(node, [path.join(repo, 'bin', 'agent-viewer.mjs'), 'coord', ...args, '--attach', origin], {
  cwd, encoding: 'utf8', env: { ...process.env, AGENT_VIEWER_CALLER_PROVIDER: 'claude' },
}))

const runId = coord('run', 'Real agent CLIs live check', '--name', 'live-lead', '--max-agents', String(agents.length + 1)).participant.runId
const taskFor = Object.fromEntries(agents.map(agent => [agent, coord('call', 'coord_create_task',
  '--title', `Write ${agent}.txt`,
  '--detail', `Create the file ${agent}.txt containing the word done, then complete this task with an honest receipt.`,
  '--paths', `${agent}.txt`).task.id]))
console.log(JSON.stringify({ stage: 'run', runId, cwd, agents }))

const bridgeEnv = (agent) => ({
  AGENT_VIEWER_COORD_TRANSPORT: 'http',
  AGENT_VIEWER_MCP_URL: origin,
  AGENT_VIEWER_COORD_IDENTITY_FILE: path.join(cwd, `.${agent}-identity.json`),
})
const prompt = (agent) => `You are a teammate in an Agent Viewer Coordinator run. Use the av MCP tools for coordination: call coord_join_run with run_id ${runId} and name ${agent}-tm (do NOT pass provider). Read your inbox, then coord_claim_task with task_id ${taskFor[agent]}, create ${agent}.txt containing done, and coord_complete_task with an honest receipt. Finally write the file .verdict-${agent}.txt containing exactly NONE if no Coordinator tool error or result confused you; otherwise list each confusing one verbatim in that file.`

function launch(agent) {
  const env = bridgeEnv(agent)
  if (agent === 'codex') {
    return spawnSync('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-c', 'approval_policy="never"',
      '-c', `mcp_servers.av.command=${JSON.stringify(node)}`, '-c', `mcp_servers.av.args=${JSON.stringify([bridge])}`,
      '-c', `mcp_servers.av.env={${Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}}`,
      '-c', 'mcp_servers.av.tool_timeout_sec=60', '-c', 'mcp_servers.av.default_tools_approval_mode="approve"',
      prompt(agent)], { cwd, encoding: 'utf8', timeout: 600_000, env: { ...process.env, PWD: cwd } })
  }
  if (agent === 'copilot') {
    const config = { mcpServers: { av: { type: 'local', command: node, args: [bridge], env, tools: ['*'] } } }
    return spawnSync('copilot', ['-p', prompt(agent), '--additional-mcp-config', JSON.stringify(config), '--allow-all-tools'],
      { cwd, encoding: 'utf8', timeout: 600_000, env: { ...process.env, PWD: cwd } })
  }
  if (agent === 'opencode') {
    const configFile = path.join(cwd, '.opencode-live.json')
    writeFileSync(configFile, JSON.stringify({ mcp: { av: { type: 'local', command: [node, bridge], enabled: true, environment: env } } }))
    const major = Number(/(\d+)\.\d+/.exec(spawnSync('opencode', ['--version'], { encoding: 'utf8' }).stdout ?? '')?.[1] ?? 0)
    return spawnSync('opencode', ['run', '--auto', ...(major >= 2 ? ['--standalone'] : []), prompt(agent)],
      { cwd, encoding: 'utf8', timeout: 600_000, env: { ...process.env, PWD: cwd, OPENCODE_CONFIG: configFile } })
  }
  throw new Error(`Unknown agent ${agent}`)
}

const failures = []
for (const agent of agents) {
  if (spawnSync(agent, ['--version'], { encoding: 'utf8' }).status !== 0) { console.log(JSON.stringify({ stage: 'skip', agent, reason: 'not installed' })); continue }
  const started = Date.now()
  const result = launch(agent)
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const status = coord('status').snapshot
  const participant = status.agents.find(entry => entry.name === `${agent}-tm`)
  const task = status.tasks.find(entry => entry.id === taskFor[agent])
  // The agent's own word on the tools, written to a file rather than read out
  // of a transcript whose order differs per CLI.
  const verdictFile = path.join(cwd, `.verdict-${agent}.txt`)
  const said = existsSync(verdictFile) ? readFileSync(verdictFile, 'utf8').trim() : ''
  const verdict = said === 'NONE' ? 'NONE' : said ? `reported: ${said.slice(0, 500)}` : 'no verdict written'
  const report = { stage: 'agent', agent, seconds: Math.round((Date.now() - started) / 1000), provider: participant?.provider ?? null, task: task?.status, fileWritten: existsSync(path.join(cwd, `${agent}.txt`)), verdict }
  console.log(JSON.stringify(report))
  try {
    assert.equal(participant?.provider, agent, `${agent}: joined under the wrong provider`)
    assert.equal(task?.status, 'completed', `${agent}: task not completed`)
    assert.ok(report.fileWritten, `${agent}: did not do the work`)
    assert.equal(verdict, 'NONE', `${agent}: ${verdict}\n${output.trim().split('\n').slice(-15).join('\n')}`)
  } catch (error) { failures.push(error.message) }
}
// A failed agent leaves its task open; stop the run rather than leave it joinable.
try { coord('call', 'coord_finalize_run', '--summary', 'Live agent check finished') } catch { fetch(`${origin}/api/agent-protocol/runs/${runId}/stop`, { method: 'POST' }).catch(() => {}) }
if (failures.length) {
  console.error(failures.join('\n\n'))
  process.exit(1)
}
console.log(JSON.stringify({ stage: 'passed', agents, runId }))
