import type { SessionIdentity } from '@/lib/sessionIdentity'

/** Existing web selection keys are shared by rows, tabs, palette, dashboard,
 * and navigation. Domain mutations continue to use sessionIdentityKey. */
export function sessionSelectionKey(session: SessionIdentity): string {
  return `${session.providerInstanceId ?? session.provider ?? 'claude'}:${session.sessionId}`
}
