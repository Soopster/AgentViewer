import type { PluginPermissionRequest, PluginTurnTarget } from './behavior'

export type PluginPermissionTrace = {
  readonly pluginId: string
  readonly mode: 'policy' | 'automation'
  readonly outcome: 'allow' | 'deny' | 'ask' | 'abstain' | 'error' | 'cancelled'
}
export type PluginPermissionReceipt = {
  readonly at: number
  readonly target: PluginTurnTarget
  readonly kind: PluginPermissionRequest['kind']
  readonly toolName?: string
  readonly decision: 'allow' | 'deny' | 'ask'
  readonly pluginId?: string
  readonly traces: readonly PluginPermissionTrace[]
}
const LIMIT = 200
const history: PluginPermissionReceipt[] = []
/** No tool arguments, commands, paths, hook reasons, credentials or transcript text are retained. */
export function recordPluginPermissionReceipt(receipt: Omit<PluginPermissionReceipt, 'at'>): void {
  history.push(Object.freeze({ ...receipt, at: Date.now(), target: Object.freeze({ ...receipt.target }), traces: Object.freeze(receipt.traces.slice(0, 100).map(trace => Object.freeze({ ...trace }))), ...(receipt.toolName ? { toolName: receipt.toolName.slice(0, 120) } : {}) }))
  if (history.length > LIMIT) history.splice(0, history.length - LIMIT)
}
export function readPluginPermissionHistory(target?: PluginTurnTarget): readonly PluginPermissionReceipt[] {
  return history.filter(receipt => !target || (receipt.target.provider === target.provider && receipt.target.providerInstanceId === target.providerInstanceId && receipt.target.sessionId === target.sessionId)).map(receipt => ({ ...receipt, target: { ...receipt.target }, traces: receipt.traces.map(trace => ({ ...trace })) }))
}
export function clearPluginPermissionHistory(): void { history.length = 0 }
