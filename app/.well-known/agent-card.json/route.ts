import { handleA2AAgentCardRequest } from '@/lib/a2aAdapter'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  return handleA2AAgentCardRequest(request)
}
