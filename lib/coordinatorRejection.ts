// A keyed Coordinator operation that threw before any side effect is a known
// outcome — nothing happened — which is different from a request whose outcome
// is unknown. Only the latter may hold a client's panel locked: a rejection the
// retry can only repeat (resuming a teammate whose task is blocked) otherwise
// locks every other action behind a request that can never be confirmed.
const REJECTED = 'coordinatorRejected'

export function markCoordinatorRejection(error: unknown): void {
  if (error instanceof Error) (error as Error & { [REJECTED]?: boolean })[REJECTED] = true
}

export function isCoordinatorRejection(error: unknown): boolean {
  return error instanceof Error && (error as Error & { [REJECTED]?: boolean })[REJECTED] === true
}
