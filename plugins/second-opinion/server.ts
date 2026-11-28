import { PLUGIN_API_VERSION } from '../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../lib/plugins/behavior'

// Auto-review: when a repository has it on, every settled turn that changed
// files is reviewed in the background. It never sends a follow-up; serious
// findings raise an attention note on the session that wrote the turn.
export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'second-opinion',
  async afterTurn({ target, signal }) {
    const [{ readViewSessionInfo }, { listTurnCheckpoints }, service] = await Promise.all([
      import('../../lib/sessionReads'),
      import('../../lib/checkpoints'),
      import('../../lib/secondOpinion/service'),
    ])
    const info = await readViewSessionInfo(target.sessionId, target.provider).catch(() => null)
    const cwd = info?.cwd
    if (!cwd || signal.aborted || !await service.secondOpinionAutoReview(cwd)) return
    // The turn that just settled is this session's newest snapshot.
    const checkpoint = (await listTurnCheckpoints(cwd)).find(entry => entry.sessionId === target.sessionId)
    if (!checkpoint || signal.aborted) return
    const snapshot = await service.nativeSecondOpinion.read(cwd)
    if (snapshot.reviews.some(record => record.checkpointSha === checkpoint.sha && record.auto)) return
    // Fire and forget: a review takes minutes and must not hold the settle pipeline.
    void service.nativeSecondOpinion.run(cwd, { checkpointSha: checkpoint.sha, auto: true }).catch(() => {})
  },
}
