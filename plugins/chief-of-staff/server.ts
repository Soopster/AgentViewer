import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { COS_CONTEXT_TAG, chiefOfStaffContext } from '../../lib/chiefOfStaff/service'
import { cosEntryForSession, setCosReport } from '../../lib/chiefOfStaff/store'

/** Tools that change files, across providers. The Chief of Staff delegates; it does not edit. */
const EDIT_TOOLS = /^(edit|write|multiedit|notebookedit|apply_patch|patch|str_replace\w*|create\w*file|write_file|edit_file)$/i
export const COS_EDIT_DENIAL = 'The Chief of Staff does not edit files. Delegate this to a teammate with coord_delegate.'

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'chief-of-staff',
  // Only a Chief of Staff session is touched: every other session's turn and approvals pass through untouched.
  async beforeTurn({ target, body }) {
    const message = body.message
    if (typeof message !== 'string' || !message.trim() || message.trimStart().startsWith('/') || message.includes(`<${COS_CONTEXT_TAG}>`)) return
    if (!cosEntryForSession(target.sessionId)) return
    const context = await chiefOfStaffContext(target.sessionId)
    if (context) return { action: 'patch', body: { message: `${message}\n\n${context}` } }
  },
  // What the Chief of Staff said last is the panel's latest report, whether a person or a schedule asked.
  async afterTurn({ target, readMessages }) {
    if (!cosEntryForSession(target.sessionId)) return
    const { lastAssistantText } = await import('../../lib/sessionGoals')
    setCosReport(target.sessionId, lastAssistantText(await readMessages(20)))
  },
  permission({ target, request }) {
    if (!request.toolName || !EDIT_TOOLS.test(request.toolName)) return
    if (!cosEntryForSession(target.sessionId)) return
    return { decision: 'deny', reason: COS_EDIT_DENIAL }
  },
}
