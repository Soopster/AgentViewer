import { handleA2AJsonRpc, type A2AJsonRpcRequest } from '@/lib/a2aAdapter'

// A2A Protocol 1.0 JSON-RPC 2.0 binding (spec §3) — the concrete endpoint
// advertised in the Agent Card's `url` field. The spec's `url` must be a
// directly-invokable endpoint, not a template, so this route takes the
// Coordinator run (A2A contextId) from `params.contextId` /
// `params.message.contextId` instead of the URL path. See
// /api/a2a/[runId] for the path-scoped convenience alias, and
// lib/a2aAdapter.ts for the shared dispatch logic.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as A2AJsonRpcRequest | null
  return handleA2AJsonRpc(body)
}
