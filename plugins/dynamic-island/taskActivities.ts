import type { ActivityInput } from '../../lib/plugins/activityFeed'
import type { ObservedTranscript } from '../../lib/plugins/observedTranscripts'
import { sessionIdentityKey } from '../../lib/sessionIdentity'
import { buildPluginTaskRegistry } from '../../lib/plugins/taskRegistry'

/** Summarize observed background work, not historical checklists or inferred progress. */
export function taskActivities(transcripts: readonly ObservedTranscript[]): ActivityInput[] {
  const result = new Map<string, ActivityInput>()
  for (const transcript of transcripts) {
    const registry = buildPluginTaskRegistry({ persisted: transcript.persisted, live: transcript.live.messages, todos: transcript.live.todos, plan: transcript.live.plan })
    for (const task of registry.values()) {
      if (!(task.isBackgrounded || task.events.some(event => ['started', 'progress', 'notified'].includes(event.kind))) || !['in_progress', 'pending', 'paused', 'failed'].includes(task.status)) continue
      const id = `task:${sessionIdentityKey(transcript.target)}:${task.id}`
      result.set(id, { id, source: 'background-tasks', target: transcript.target, messageUuid: task.latestEventUuid,
        title: task.subject || `Task ${task.id}`, status: task.status === 'failed' ? 'error' : task.status === 'paused' ? 'waiting' : 'running',
        detail: task.error || task.activeForm || task.summary || task.command })
    }
  }
  return [...result.values()]
}
