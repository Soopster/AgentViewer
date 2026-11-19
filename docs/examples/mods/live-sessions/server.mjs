import { createHash } from 'node:crypto'
const itemId = session => createHash('sha256').update(session.key).digest('hex').slice(0, 24)
// Server contexts receive immutable app data; navigation is returned as effects.
export const views = {
  sessions: ({ app }) => ({
    title: 'Live sessions',
    blocks: [
      { type: 'text', text: app ? `${app.renderer} · ${app.cwd ?? 'no repository'}` : 'App context is unavailable.' },
      ...(app?.sessions ?? []).slice(0, 100).map(session => ({ type: 'item', id: itemId(session), label: session.title, detail: session.activity, action: 'open' })),
      { type: 'button', label: 'Open Git', action: 'git' },
    ],
  }),
}
export const actions = {
  open: ({ app, item }) => {
    const session = app?.sessions.find(candidate => itemId(candidate) === item)
    return session ? { appEffects: [{ type: 'session', target: session.target }] } : { notice: 'Session is no longer listed.' }
  },
  git: () => ({ appEffects: [{ type: 'command', id: 'git' }] }),
}
