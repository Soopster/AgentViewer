import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'
import { MATT_CONTEXT_TAG, mattMessage, parseMattCommand } from '../../lib/mattSkills/command'

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'matt-skills',
  // Only a message that starts with /matt is touched.
  async beforeTurn({ body }) {
    const message = body.message
    if (typeof message !== 'string' || !/^\s*\/matt(\s|$)/.test(message) || message.includes(`<${MATT_CONTEXT_TAG}`)) return
    const { mattLibrary, mattSetup } = await import('../../lib/mattSkills/service')
    const skills = mattLibrary.list()
    if (!skills.length) return { action: 'block', reason: `The Matt Pocock skill files are missing from ${mattLibrary.libraryDir()}.` }
    const command = parseMattCommand(message, skills)
    if (!command) return
    if ('error' in command) return { action: 'block', reason: command.error }
    const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : process.cwd()
    return { action: 'patch', body: { message: mattMessage({
      ...command, root: mattLibrary.libraryDir(), adapter: `${mattLibrary.dir()}/adapter.md`, configured: mattSetup(cwd).configured,
    }) } }
  },
}
