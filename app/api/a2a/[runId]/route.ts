import { handleA2AHttpRequest } from '@/lib/a2aAdapter'

// A2A Protocol 1.0 JSON-RPC 2.0 binding (spec §3) scoped to one Coordinator
// run via the URL — a convenience alias over the card-advertised global
// endpoint at /api/a2a. It retains the same version and bearer gates and
// cannot create runs or spawn agent processes from inbound messages.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  return handleA2AHttpRequest(request, runId)
}
