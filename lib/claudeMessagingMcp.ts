/**
 * Always-on Claude SDK MCP server exposing cross-session messaging as tools
 * — the local equivalent of Claude Code's own ListAgents/SendMessage (see
 * https://code.claude.com/docs/en/cross-session-messaging), scoped to
 * sessions this Agent Viewer instance can reach. Unlike lib/agentCoordinationSdkTools.ts's
 * coord_* tools, this server isn't gated on joining an AVP/2 run — it's
 * available to every Claude session Agent Viewer runs.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { describeSelf, listAddressableSessions, sendCrossSessionMessage } from './crossSessionMessaging'

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export function createMessagingMcpServer(sessionId: string) {
  return createSdkMcpServer({
    name: 'agent-viewer-messaging',
    tools: [
      tool(
        'list_sessions',
        'List other Agent Viewer sessions on this machine you can message right now (running turns and recently active sessions across every provider Agent Viewer supports). Use the exact returned name with message_session.',
        {},
        async () => {
          const sessions = await listAddressableSessions(sessionId)
          return textResult({
            sessions: sessions.map((s) => ({
              name: s.name,
              provider: s.provider,
              running: s.running,
              cwd: s.cwd,
              title: s.title,
            })),
          })
        },
      ),
      tool(
        'message_session',
        'Send a short plain-text message to another Agent Viewer session by the name shown in list_sessions. The receiving session reads it as a message from you, never as conversation history or files — it cannot approve permissions or change settings on your behalf.',
        {
          to: z.string().describe('Target session name, as shown by list_sessions'),
          text: z.string().describe('The message text to deliver'),
        },
        async (args: { to: string; text: string }) => {
          const fromName = await describeSelf(sessionId)
          const result = await sendCrossSessionMessage({ fromSessionId: sessionId, fromName, toName: args.to, text: args.text })
          return textResult(result)
        },
      ),
    ],
  })
}
