# Composing mod permission decisions

A permission hook sees a provider approval request, not every tool execution.
The host never claims to override SDK-enforced permission ceilings or sandbox
restrictions. Questions and plan approvals remain separate from this hook.

Existing mods default to `behavior.permissionMode: "automation"`. To mark a
mandatory check within the enabled plugin pipeline, declare:

```json
{
  "behavior": {
    "hooks": ["permission"],
    "permissionMode": "policy"
  }
}
```

Return `{ decision: "allow" | "deny" | "ask", reason? }`, or nothing to abstain.
All enabled policy hooks run before any automation hook, regardless of numeric
order. Within each group the existing order/plugin-ID ordering is preserved.
A policy deny wins over every allow or ask, including another policy's allow.
An explicit policy ask, error, timeout or cancellation forces human approval if
no policy denied; automation cannot approve over it. A policy allow is effective
only once all other policy hooks have passed or abstained. Otherwise automation
retains its first-decision ordering. An automation failure or explicit ask stops
automatic approval and falls back to the person. The existing five-second budget
applies per permission hook. Disabled hooks do not run.

This is composition among enabled plugins, not an organization-managed trust
boundary. A user can disable a policy mod, and trusted in-process mod code retains
host permissions. Existing research-session restrictions still run before plugin
policy. They are not weakened by a plugin allow. A permitted research read
continues through configured permission hooks, so its built-in allow cannot skip
a plugin policy deny or ask. If all hooks abstain, permitted research reads retain their automatic approval;
a failure or explicit ask cannot fall through to that default.

`readPluginPermissionHistory(target?)` from `lib/plugins/permissionHistory.ts`
returns a copy of at most 200 process-local receipts. Optional target filtering
matches provider + instance + session exactly. Each receipt records final
allow/deny/ask, contributing plugin IDs/modes, and outcomes (allow/deny/ask/
abstain/error/cancelled). It intentionally excludes commands, paths, tool inputs,
result text, hook reason strings, exception text and transcript content. Tool
names are bounded to 120 characters; traces are bounded to 100 per receipt.
History is diagnostic, not durable audit storage and not cross-process history.

Run `bun scripts/pluginPermissionPolicySmoke.ts` for policy precedence, errors,
explicit ask, automatic approvals, disablement, redaction and target filtering.

Inspection snapshots publish the same redacted receipts and per-provider runtime
capabilities. Use `agent-viewer mods status --instance <id> --json`; Web also
exposes history through `GET /api/plugins/inspection`. Published history belongs
to the serving process (Web tabs may share it), carries qualified session IDs,
and is bounded rather than durable. Stale snapshots are labeled as such.
