import type { PiActivitySnapshot } from '../piActivity'
import type { ActivityInput } from './activityFeed'

export function piStartupActivity(snapshot: PiActivitySnapshot): ActivityInput[] {
  if (snapshot.stage === 'idle') return []
  return [{
    id: 'pi:startup', source: 'pi-startup', title: snapshot.headline,
    status: snapshot.active ? 'running' : snapshot.stage === 'error' ? 'error' : 'success',
    detail: snapshot.events.slice(-8).map(event => event.message).join('\n'),
    updatedAt: snapshot.updatedAt,
    expiresAt: !snapshot.active && snapshot.stage === 'ready' ? snapshot.updatedAt + 6000 : undefined,
  }]
}
