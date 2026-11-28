import { createHash } from 'node:crypto'
import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule, PluginToolHandler } from '../../lib/plugins/behavior'
import { isRecallable, latestTurnReply, parseMemoryTags, rankProjectMemory, agentMemoryOn, isAgentNote, memoryTitleKey, type MemoryKind } from '../../lib/plugins/projectMemory'
import { nativeProjectMemory, recallProjectMemory, resolveTurnCwd } from '../../lib/project-memory/service'

const requestKey = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex')
const projectFor = (args: Record<string, unknown>, cwd?: string) => {
  const project = typeof args.project === 'string' ? args.project : cwd
  if (!project) throw new Error('No project directory is known for this call: pass "project" as an absolute path')
  return project
}

const tools: Record<string, PluginToolHandler> = {
  async recall(args, { signal, cwd }) {
    const project = projectFor(args, cwd), snapshot = await nativeProjectMemory.peek(project, signal)
    const recallable = snapshot.notes.filter(note => isRecallable(snapshot, note))
    const off = agentMemoryOn(snapshot) ? '' : '\n(Agent memory is turned off for this project: remember will not save.)'
    if (!recallable.length) return `No memories for ${project} yet.${off}`
    const query = typeof args.query === 'string' ? args.query : ''
    if (!query.trim()) return `${recallable.length} memories for ${project}:\n${recallable.map(note => `- ${note.title} (${note.kind}${isAgentNote(note) ? ', agent' : ''})`).join('\n')}${off}`
    const found = rankProjectMemory(recallable, query).slice(0, typeof args.limit === 'number' ? args.limit : 8)
    if (!found.length) return `No memory matches "${query.slice(0, 200)}". Recall without a query lists all ${recallable.length}.${off}`
    return found.map(note => `### ${note.title}\n${note.kind}${isAgentNote(note) ? ' · agent-written' : ''} · updated ${new Date(note.updatedAt).toISOString().slice(0, 10)}\n${note.body}`).join('\n\n') + off
  },
  async remember(args, { signal, cwd }) {
    const project = projectFor(args, cwd), before = await nativeProjectMemory.peek(project, signal)
    if (!agentMemoryOn(before)) return 'Agent memory is turned off for this project; nothing was saved.'
    const title = String(args.title), kind = (typeof args.kind === 'string' ? args.kind : 'lesson') as MemoryKind, key = memoryTitleKey(title)
    const snapshot = await nativeProjectMemory.mutate(project, crypto.randomUUID(), { type: 'agent-remember', title, body: String(args.body), kind }, signal)
    const updated = before.notes.some(note => isAgentNote(note) && memoryTitleKey(note.title) === key)
    const clash = snapshot.notes.some(note => !isAgentNote(note) && memoryTitleKey(note.title) === key)
    return `${updated ? 'Updated' : 'Remembered'} "${title}".${clash ? ' A person\'s note has the same title; it was left as it is.' : ''}`
  },
  async forget(args, { signal, cwd }) {
    await nativeProjectMemory.mutate(projectFor(args, cwd), crypto.randomUUID(), { type: 'agent-forget', title: String(args.title) }, signal)
    return `Forgot "${String(args.title)}".`
  },
}

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'project-memory',
  async beforeTurn(context) { const message = await recallProjectMemory(context); if (message) return { action: 'patch', body: { message } } },
  // Memory tags in the reply become notes. Keyed on the reply's message, so a turn observed twice saves once.
  async afterTurn(context) {
    const reply = latestTurnReply(await context.readMessages(40))
    if (!reply) return
    const tags = parseMemoryTags(reply.text)
    if (!tags.length) return
    const cwd = await resolveTurnCwd(context.target)
    if (!cwd || !agentMemoryOn(await nativeProjectMemory.peek(cwd, context.signal))) return
    const { provider, providerInstanceId, sessionId } = context.target
    const source = { provider, ...(providerInstanceId ? { providerInstanceId } : {}), sessionId, messageUuid: reply.uuid }
    for (const [index, tag] of tags.entries()) {
      const operation = tag.op === 'remember' ? { type: 'agent-remember' as const, title: tag.title, body: tag.body, kind: tag.kind, source } : { type: 'agent-forget' as const, title: tag.title }
      // A refused write (a person's note, the cap) is not the turn's failure; the next recall shows what is stored.
      try { await nativeProjectMemory.mutate(cwd, requestKey(sessionId, reply.uuid, String(index)), operation, context.signal) } catch (error) { if (context.signal.aborted) throw error }
    }
  },
  tools,
}
