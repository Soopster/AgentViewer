// LM Studio: a local OpenAI-compatible server, so sessions are records this
// app owns outright (lib/lmstudioClient.ts) rather than state a CLI keeps for
// us. That makes it the simplest adapter — title and tag are plain column
// writes, and there is no subagent, composer-option, or slash-command surface
// to expose, so those methods are absent rather than empty.

import {
  deleteLmstudioSession,
  getLmstudioSession,
  listLmstudioModels,
  listLmstudioSessions,
  lmstudioBaseUrl,
  patchLmstudioSession,
} from '../lmstudioClient'
import {
  mapLmstudioSessionToInfo,
  mapLmstudioSessionToMessages,
  mapLmstudioSessionToSession,
} from '../lmstudioMapper'
import type { SessionAdapter } from './types'

export const lmstudioAdapter: SessionAdapter = {
  provider: 'lmstudio',

  async listSessions({ limit, offset, dir }) {
    const sessions = await listLmstudioSessions()
    const filtered = dir ? sessions.filter((s) => s.cwd === dir) : sessions
    return filtered.slice(offset, offset + limit).map(mapLmstudioSessionToSession)
  },

  async readSessionInfo(sessionId) {
    const record = await getLmstudioSession(sessionId)
    if (!record) return null
    return mapLmstudioSessionToInfo(record)
  },

  async setTitle(sessionId, title) {
    await patchLmstudioSession(sessionId, { title })
  },

  async setTag(sessionId, tag) {
    await patchLmstudioSession(sessionId, { tag })
  },

  async deleteSession(sessionId) {
    await deleteLmstudioSession(sessionId)
  },

  async readAllMessages(sessionId) {
    const record = await getLmstudioSession(sessionId)
    return { messages: record ? mapLmstudioSessionToMessages(record) : [] }
  },

  async readModels(sessionId) {
    const record = await getLmstudioSession(sessionId)
    // A stopped LM Studio server is an ordinary state, not an error — fall
    // back to an empty picker so the rest of the session view still loads.
    const models = await listLmstudioModels().catch(() => [])
    return {
      models: models.map((m) => ({ value: m.id, displayName: m.id, description: 'LM Studio local model' })),
      currentModel: record?.model ?? null,
      contextUsage: null,
    }
  },

  async readDiagnostics(sessionId) {
    const record = await getLmstudioSession(sessionId)
    return {
      currentModel: record?.model ?? null,
      sections: [
        { id: 'server', title: 'LM STUDIO SERVER', items: [lmstudioBaseUrl()] },
        { id: 'messages', title: 'MESSAGES', items: [String(record?.messages.length ?? 0)] },
      ],
    }
  },
}
