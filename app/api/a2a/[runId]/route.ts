import { handleA2AJsonRpc, type A2AJsonRpcRequest } from '@/lib/a2aAdapter'

// A2A Protocol 1.0 JSON-RPC 2.0 binding (spec §3) scoped to one Coordinator
// run via the URL — a convenience alias over the card-advertised global
// endpoint at /api/a2a. See lib/a2aAdapter.ts for what "conformance" means
// here and what's out of scope (push notifications, spawning new runs from
// inbound messages).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const body = await request.json().catch(() => null) as A2AJsonRpcRequest | null
  return handleA2AJsonRpc(body, runId)
}
