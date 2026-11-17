import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginApplicationModule, PluginSessionActivity } from '../../lib/plugins/application'
import type { GitSummary } from '../../lib/gitProvider'
import type { ProofSnapshot } from '../../lib/plugins/proof'
import { REPO_SOURCE, repoActivities } from './insights/repo'
import { HEALTH_SOURCE, healthActivities } from './insights/health'
import { TEAM_SOURCE, teamActivities } from './insights/team'
import { APPROVALS_SOURCE, approvalActivities } from './insights/approvals'

export const application: PluginApplicationModule = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'dynamic-island',
  activate({ services, defer, signal }) {
    const feed = services.activity!
    const permissions = services.permissions!
    const repository = services.repository!
    // Project state is read slowly and only while the app is in front; the answer is cached and re-derived on every snapshot.
    const REPO_REFRESH_MS = 30_000
    let repoRead: { cwd: string; git: GitSummary | null; proof: ProofSnapshot | null; at: number } | null = null
    let repoReading = false
    let previous = new Map<string, PluginSessionActivity>()
    // First sighting of a running turn, for hosts that cannot say when it began.
    const firstSeen = new Map<string, number>()
    defer(() => { feed.removeSource('sessions'); feed.removeSource(APPROVALS_SOURCE); feed.removeSource(TEAM_SOURCE); feed.removeSource(HEALTH_SOURCE); feed.removeSource(REPO_SOURCE) })
    const refreshRepo = (cwd: string, at: number) => {
      repoReading = true
      void Promise.all([repository.readGit(cwd).catch(() => null), repository.readProof(cwd, signal).catch(() => null)])
        .then(([git, proof]) => { if (!signal.aborted) repoRead = { cwd, git, proof, at } })
        .finally(() => { repoReading = false })
    }
    return {
      onSessionActivity(snapshot) {
        const sessions = new Map(snapshot.sessions.map(session => [session.key, session]))
        const pending = snapshot.pending ?? new Map()
        const titles = new Map(snapshot.sessions.map(session => [session.key, session.title]))
        const targets = new Map(snapshot.sessions.flatMap(session => session.target ? [[session.key, session.target] as const] : []))
        // Replacing the source also resolves asks that were answered elsewhere.
        feed.replaceSource(APPROVALS_SOURCE, approvalActivities(pending, titles, targets, permissions.respond, snapshot.now))
        if (snapshot.teams) feed.replaceSource(TEAM_SOURCE, teamActivities(snapshot.teams, titles, targets, snapshot.now))
        const cwd = snapshot.cwd ?? null
        if (!cwd) { repoRead = null; feed.removeSource(REPO_SOURCE) }
        else {
          if (!repoReading && snapshot.focused !== false && (repoRead?.cwd !== cwd || snapshot.now - repoRead.at >= REPO_REFRESH_MS)) refreshRepo(cwd, snapshot.now)
          if (repoRead?.cwd === cwd) {
            const selected = snapshot.selectedKey
            feed.replaceSource(REPO_SOURCE, repoActivities({ cwd, git: repoRead.git, proof: repoRead.proof, now: snapshot.now,
              turnRunning: selected !== null && snapshot.activity.get(selected) === 'running', target: selected ? targets.get(selected) : undefined }))
          } else feed.removeSource(REPO_SOURCE)
        }
        for (const key of [...firstSeen.keys()]) if (snapshot.activity.get(key) !== 'running') firstSeen.delete(key)
        for (const [key, state] of snapshot.activity) if (state === 'running' && !firstSeen.has(key)) firstSeen.set(key, snapshot.now)
        feed.replaceSource(HEALTH_SOURCE, healthActivities(snapshot.activity, new Map([...firstSeen, ...(snapshot.started ?? [])]), titles, targets, snapshot.now))
        for (const [key, status] of snapshot.activity) {
          // A session waiting on a listed ask is that ask's row, not a second "Needs input".
          if (status === 'needs-input' && (pending.get(key)?.length ?? 0) > 0) { feed.remove(`session:${key}`); continue }
          const session = sessions.get(key)
          const label = status === 'needs-input' ? 'Needs input' : status === 'waiting' ? 'Waiting' : 'Running'
          feed.publish({ id: `session:${key}`, source: 'sessions', status,
            title: session?.title || 'Agent session', detail: label, target: session?.target })
        }
        for (const key of previous.keys()) {
          if (snapshot.activity.has(key)) continue
          const session = sessions.get(key)
          feed.publish({ id: `session:${key}`, source: 'sessions', status: 'info',
            title: session?.title || 'Agent session', detail: 'Turn ended', target: session?.target, expiresAt: snapshot.now + 6000 })
        }
        previous = new Map(snapshot.activity)
      },
    }
  },
}
