import { handleA2AHttpRequest } from '@/lib/a2aAdapter'

// A2A Protocol 1.0 JSON-RPC 2.0 binding — the concrete endpoint advertised
// as the Agent Card's preferred supportedInterface. This route takes the
// Coordinator run (A2A contextId) from `params.contextId` /
// `params.message.contextId` instead of the URL path. See
// /api/a2a/[runId] for the path-scoped convenience alias, and
// lib/a2aAdapter.ts for version and bearer gates plus shared dispatch.
export async function POST(request: Request) {
  return handleA2AHttpRequest(request)
}
