---
name: Agent Viewer project
description: Next.js dashboard using @anthropic-ai/claude-agent-sdk to list sessions and messages
type: project
---

Next.js 15 app at /Users/lukeryan/Documents/src/agentViewer using the official Claude Agent SDK (listSessions, getSessionMessages) instead of parsing JSONL files directly.

**Why:** Previous JSONL parsing approach was fragile — could break if Claude changed file format. Official API is stable.

**How to apply:** Run with `npm run dev`, opens at localhost:3000. API routes in app/api/sessions/ handle the SDK calls server-side.

**Key file:** components/MessageView.tsx has a `filterMessages` function (with TODO comment) where the user decides what message types to show.
