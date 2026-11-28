import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Static, TSchema } from 'typebox'
import type { PendingQuestion, PendingQuestionAnswers } from '../permissions'
import { requestPiInterview } from '../piExtensionUi'
import { hasResearchToolPolicy } from '../sessionResearchPolicy'
import { applyPluginSettings, isPluginEnabled } from './enablement'
import { readPluginSettingsFile } from './settingsFile'
import { bundledPiToolLoaders } from './serverBehaviors'

export type PiToolContribution<Schema extends TSchema> = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly parameters: Schema
  readonly run: (params: Static<Schema>, ask: (title: string, questions: PendingQuestion[]) => Promise<PendingQuestionAnswers | undefined>) => Promise<string>
}

type PiToolPluginId = keyof typeof bundledPiToolLoaders

export function piPluginToolIds(): PiToolPluginId[] {
  applyPluginSettings(readPluginSettingsFile())
  return (Object.keys(bundledPiToolLoaders) as PiToolPluginId[]).filter(isPluginEnabled)
}

function adaptTool<Schema extends TSchema>(id: PiToolPluginId, contribution: PiToolContribution<Schema>): ToolDefinition<Schema> {
  const { run, ...definition } = contribution
  return {
    ...definition,
    async execute(toolCallId, params, signal, _update, context) {
      const sessionId = context.sessionManager.getSessionId()
      if (!isPluginEnabled(id) || hasResearchToolPolicy('pi', sessionId)) throw new Error('This tool is unavailable for this session.')
      const text = await run(params, (title, questions) => requestPiInterview(sessionId, toolCallId, title, questions, signal))
      return { content: [{ type: 'text', text }], details: undefined }
    },
  }
}

export function loadPiPluginTools(ids: PiToolPluginId[]): Promise<ToolDefinition[]> {
  return Promise.all(ids.map(async id => adaptTool(id, await bundledPiToolLoaders[id]())))
}
