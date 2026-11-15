// The request an agent receives to design a card for one shape. It names the
// file to write, the format and the rules, and carries redacted samples; the
// agent uses its ordinary file tools and the rule lands as a draft.
import { vocabularyMarkdown } from './vocabulary'
import type { ShapeRecord } from './shapes'

export function ruleIdFor(tool: string): string {
  return tool.toLowerCase().replace(/^mcp__/, '').replace(/__/g, '.').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 56) || 'card'
}

export function buildDesignPrompt(shape: Pick<ShapeRecord, 'tool' | 'mcpServer' | 'inputKeys' | 'samples'>, dir: string, preference?: string | null): string {
  const id = ruleIdFor(shape.tool)
  const samples = shape.samples.map((sample, index) => `Sample ${index + 1}\ninput: ${JSON.stringify(sample.input)}${sample.result ? `\nresult${sample.result.isError ? ' (error)' : ''}: ${sample.result.text}` : ''}`).join('\n\n') || '(no samples were kept: ask me to run the tool once)'
  return [
    `Design a transcript card for the tool \`${shape.tool}\`${shape.mcpServer ? ` (MCP server \`${shape.mcpServer}\`)` : ''}. Today it is drawn by a generic card.`,
    `Write ONE file: ${dir}/${id}.json  with status "draft" (I review it before it is used). Format:`,
    '{ "id": "' + id + '", "status": "draft", "match": { "tool": "' + shape.tool + '" },',
    '  "title": "…{{bindings}}…", "tone": "info" | [{ "when": { "path": "result.json.state", "equals": "Done" }, "tone": "success" }],',
    '  "blocks": [ …blocks below… ] }',
    vocabularyMarkdown(),
    'Add a short "rationale": { "intent", "choices": [{ "block", "reason" }], "alternatives": [], "assumptions": [] } saying why the card is the way it is. It is shown to the person beside the card, so keep it true to what you wrote.',
    ...(preference ? [preference] : []),
    'While the call is running there is no result, so bindings to result.* are empty. A failed call is shown as an error whatever you write.',
    `Show what a person needs at a glance: the title says what was asked and what came back; blocks show the few fields that matter, not the whole payload. Input keys: ${shape.inputKeys.join(', ') || '(none)'}.`,
    `After writing the file, run \`agent-viewer cards check ${dir}/${id}.json\` and fix anything it reports, then \`agent-viewer cards preview ${id}\` to see what the samples will draw. Do not enable the rule: I do that after reviewing the preview.`,
    samples,
  ].join('\n\n')
}

/** The request an agent gets to change a rule: read it, make a patch against its revision, check, leave it a draft. */
export function buildRefinePrompt(rule: { id: string; revision?: number }, dir: string): string {
  return [
    `Change the transcript card rule "${rule.id}" (${dir}/${rule.id}.json). Tell me what you want changed, then:`,
    `1. Run \`agent-viewer cards show ${rule.id}\` to read it (it is at revision ${rule.revision ?? 1}).`,
    `2. Write a patch file { "baseRevision": <that revision>, "operations": [ … ] } and run \`agent-viewer cards patch ${rule.id} <patch.json>\`. A patch against an older revision is refused: read the rule again and redo the change.`,
    '   Operations: set-title {title} · set-tone {tone} · replace-block {index, block} · insert-block {index, block} · remove-block {index} · set-rationale {rationale}.',
    `3. Run \`agent-viewer cards preview ${rule.id}\`. A patched rule goes back to draft; do not enable it, I do that after the preview.`,
    'Run `agent-viewer cards schema` for the blocks, bindings and formatters.',
  ].join('\n')
}
