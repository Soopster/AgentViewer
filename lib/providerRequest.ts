import type { AgentProvider } from './types'
import { getConfiguredProviderTarget } from './providerState'
import { withProviderInstance } from './providerInstances'

export function providerInstanceIdFromRequest(
  request: Request,
  body?: Record<string, unknown>,
): string | undefined {
  if (typeof body?.providerInstanceId === 'string' && body.providerInstanceId.trim()) {
    return body.providerInstanceId.trim()
  }
  return new URL(request.url).searchParams.get('providerInstanceId')?.trim() || undefined
}

export async function withProviderRequest<T>(
  request: Request,
  provider: AgentProvider | undefined,
  body: Record<string, unknown> | undefined,
  run: () => T | Promise<T>,
): Promise<T> {
  if (!provider) return run()
  let providerInstanceId = providerInstanceIdFromRequest(request, body)
  if (!providerInstanceId) {
    const configured = await getConfiguredProviderTarget()
    if (configured.provider === provider) providerInstanceId = configured.providerInstanceId
  }
  return withProviderInstance(providerInstanceId, provider, run)
}
