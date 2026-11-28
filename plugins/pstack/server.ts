import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { parsePstackCommand, PSTACK_CONTEXT_TAG, pstackMessage } from '../../lib/pstack/command'

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pstack',
  // Only a message that starts with /pstack is touched.
  async beforeTurn({ body, signal }) {
    const message = body.message
    if (typeof message !== 'string' || !/^\s*\/pstack(\s|$)/.test(message) || message.includes(`<${PSTACK_CONTEXT_TAG}`)) return
    const { listPstackSkills, pstackDir, pstackLibraryDir } = await import('../../lib/pstack/library')
    const skills = listPstackSkills()
    if (!skills.length) return { action: 'block', reason: `pstack's skill files are missing from ${pstackLibraryDir()}.` }
    const command = parsePstackCommand(message, skills)
    if (!command) return
    if ('error' in command) return { action: 'block', reason: command.error }
    const { readPstack } = await import('../../lib/pstack/service')
    const { formatRoleTable } = await import('../../lib/pstack/roles')
    const state = await readPstack(typeof body.cwd === 'string' && body.cwd ? body.cwd : process.cwd())
    signal.throwIfAborted()
    return { action: 'patch', body: { message: pstackMessage({
      ...command, root: pstackLibraryDir(), adapter: `${pstackDir()}/adapter.md`, roleTable: formatRoleTable(state.roles, state.problems),
    }) } }
  },
}
