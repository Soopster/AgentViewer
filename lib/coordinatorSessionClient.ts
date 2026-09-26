import { chmod, mkdir, writeFile, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ExternalProtocolIdentity } from './agentProtocol'

// Materialized beside a private binding, so installed/standalone builds do not
// depend on a source-tree bin path. Credentials never enter the model prompt.
const CLIENT_SOURCE = `import { readFile } from 'node:fs/promises';
const [bindingPath, tool, json = '{}'] = process.argv.slice(2);
try {
  if (!bindingPath || !tool) throw new Error('Usage: client.mjs binding.json coord_tool JSON_arguments');
  const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
  const args = JSON.parse(json);
  if (!['coord_status', 'coord_query_context', 'coord_wait', 'coord_list_roles'].includes(tool) && !args.request_id) {
    throw new Error('Supply request_id on the first mutation and reuse it with identical arguments on retry');
  }
  const response = await fetch(binding.url + '/participant', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + binding.token },
    body: JSON.stringify({ runId: binding.runId, agentId: binding.agentId, tool, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.text || result.error || 'Coordinator request failed');
  process.stdout.write(result.text + '\\n');
} catch (error) { process.stderr.write(String(error.message) + '\\n'); process.exitCode = 1; }
`
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export async function writeCoordinatorSessionClient(directory: string, url: string, identity: ExternalProtocolIdentity): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(`${identity.runId}:${identity.agentId}`).digest('hex').slice(0, 32)
  const client = path.join(directory, 'client.mjs')
  const binding = path.join(directory, `${key}.json`)
  const clientTemp = `${client}.${randomUUID()}.tmp`
  const bindingTemp = `${binding}.${randomUUID()}.tmp`
  await writeFile(clientTemp, CLIENT_SOURCE, { mode: 0o600 })
  await rename(clientTemp, client)
  await writeFile(bindingTemp, JSON.stringify({ url, ...identity }), { mode: 0o600 })
  await rename(bindingTemp, binding)
  await chmod(binding, 0o600)
  return `${shellQuote(process.execPath)} ${shellQuote(client)} ${shellQuote(binding)}`
}
