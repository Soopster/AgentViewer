import { readEngineeringRepository, type EngineeringRepository } from './engineering/repository'

export type EngineeringRepositoryRequest = { id: number; cwd: string }
export type EngineeringRepositoryResponse = { id: number; value?: EngineeringRepository; error?: string }
declare const self: {
  onmessage: ((event: MessageEvent<EngineeringRepositoryRequest>) => void) | null
  postMessage: (message: EngineeringRepositoryResponse) => void
}
self.onmessage = async ({ data }) => {
  try { self.postMessage({ id: data.id, value: await readEngineeringRepository(data.cwd) }) }
  catch (cause) { self.postMessage({ id: data.id, error: cause instanceof Error ? cause.message : String(cause) }) }
}
