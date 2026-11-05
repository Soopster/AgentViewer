import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ExternalProtocolIdentity } from './agentProtocol'
import type { AcpMcpServer } from './acpClientPool'

// The coord_* tools for a managed ACP teammate.
//
// Every other in-process provider is handed its tools as objects. An ACP agent
// is a separate process that only accepts MCP servers, declared once in
// `session/new` — so its tools are a stdio MCP server it spawns itself. The
// full bridge (bin/agent-viewer-mcp.mjs) talks to the web API, which does not
// exist when the TUI hosts the run; this one talks to the local Coordinator
// bridge (lib/coordinatorBridgeServer.ts), which always does.
//
// Like the session-bound shell client it is materialized beside a private
// binding, so an installed build does not depend on a source-tree path and the
// credential is read from a 0600 file rather than passed in the agent's
// environment or the model's prompt.

export type CoordinatorAcpTool = { name: string; description: string; inputSchema: unknown }

// Newline-delimited JSON-RPC over stdio, which is the whole of MCP's stdio
// transport. No dependencies: it runs under whichever runtime hosts the app.
const SERVER_SOURCE = `import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
const [bindingPath, toolsPath] = process.argv.slice(2);
const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
const tools = JSON.parse(await readFile(toolsPath, 'utf8'));
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
async function call(name, args) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
  // One key per call, so a transport retry of this request cannot apply twice.
  if (tool.inputSchema?.properties?.request_id && !args.request_id) args = { ...args, request_id: 'acp-' + randomUUID() };
  let response;
  try { response = await fetch(binding.url + '/participant', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + binding.token },
    body: JSON.stringify({ runId: binding.runId, agentId: binding.agentId, tool: name, args }),
  }); } catch {
    return { content: [{ type: 'text', text: 'Coordinator bridge connection failed. A submitted mutation may have applied: inspect coord_status and coord_read_inbox before retrying with the identical arguments and request_id ' + (args.request_id ?? '') + '.' }], isError: true };
  }
  let result;
  try { result = await response.json(); } catch { result = { error: 'Coordinator bridge returned an unreadable response (HTTP ' + response.status + ').' }; }
  return response.ok
    ? { content: [{ type: 'text', text: String(result.text ?? '') }] }
    : { content: [{ type: 'text', text: String(result.text || result.error || 'Coordinator request failed') }], isError: true };
}
for await (const line of createInterface({ input: process.stdin })) {
  let message;
  try { message = JSON.parse(line); } catch { continue; }
  const { id, method, params } = message;
  if (id === undefined || id === null) continue;
  if (method === 'initialize') send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent-viewer', version: '1.0.0' } } });
  else if (method === 'ping') send({ id, result: {} });
  else if (method === 'tools/list') send({ id, result: { tools } });
  else if (method === 'tools/call') void call(String(params?.name ?? ''), params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}).then((result) => send({ id, result }));
  else send({ id, error: { code: -32601, message: 'Method not found: ' + method } });
}
`

async function writePrivate(file: string, contents: string): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`
  await writeFile(temp, contents, { mode: 0o600 })
  await rename(temp, file)
  await chmod(file, 0o600)
}

/** Write the server, its tool list and this participant's binding; return the MCP server entry for `session/new`. */
export async function writeCoordinatorAcpMcpServer(
  directory: string,
  url: string,
  identity: ExternalProtocolIdentity,
  tools: CoordinatorAcpTool[],
): Promise<AcpMcpServer> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(`${identity.runId}:${identity.agentId}`).digest('hex').slice(0, 32)
  const server = path.join(directory, 'acp-mcp.mjs')
  const toolList = path.join(directory, 'acp-mcp-tools.json')
  const binding = path.join(directory, `${key}.acp.json`)
  await writePrivate(server, SERVER_SOURCE)
  await writePrivate(toolList, JSON.stringify(tools))
  await writePrivate(binding, JSON.stringify({ url, ...identity }))
  return { name: 'agent-viewer', command: process.execPath, args: [server, binding, toolList], env: [] }
}
