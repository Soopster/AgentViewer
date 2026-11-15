// The request an agent receives to design a card for one shape. It names the
// file to write, the format and the rules, and carries redacted samples; the
// agent uses its ordinary file tools and the rule lands as a draft.
import { CARD_FORMATTERS, CARD_RULE_LIMITS } from '../plugins/cardTemplates'
import type { ShapeRecord } from './shapes'

export function ruleIdFor(tool: string): string {
  return tool.toLowerCase().replace(/^mcp__/, '').replace(/__/g, '.').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 56) || 'card'
}

export function buildDesignPrompt(shape: Pick<ShapeRecord, 'tool' | 'mcpServer' | 'inputKeys' | 'samples'>, dir: string): string {
  const id = ruleIdFor(shape.tool)
  const samples = shape.samples.map((sample, index) => `Sample ${index + 1}\ninput: ${JSON.stringify(sample.input)}${sample.result ? `\nresult${sample.result.isError ? ' (error)' : ''}: ${sample.result.text}` : ''}`).join('\n\n') || '(no samples were kept: ask me to run the tool once)'
  return [
    `Design a transcript card for the tool \`${shape.tool}\`${shape.mcpServer ? ` (MCP server \`${shape.mcpServer}\`)` : ''}. Today it is drawn by a generic card.`,
    `Write ONE file: ${dir}/${id}.json  with status "draft" (I review it before it is used). Format:`,
    '{ "id": "' + id + '", "status": "draft", "match": { "tool": "' + shape.tool + '" },',
    '  "title": "…{{bindings}}…", "tone": "info" | [{ "when": { "path": "result.json.state", "equals": "Done" }, "tone": "success" }],',
    '  "blocks": [ heading | text | badge | code {text} | progress {label,value,max} | kv {rows:[[key,value]]} | table {rowsFrom,columns:[{header,path}]} ] }',
    `Bindings start with input., result. (result.text, result.isError, result.json when the result is JSON) or tool.name, and may pipe through: ${CARD_FORMATTERS.join(', ')} (e.g. {{input.path | basename}}, {{result.json.name | default none}}).`,
    `Limits: at most ${CARD_RULE_LIMITS.blocks} blocks, ${CARD_RULE_LIMITS.template} characters per template. No code, no other bindings. While the call is running there is no result, so bindings to result.* are empty. A failed call is shown as an error whatever you write.`,
    `Show what a person needs at a glance: the title says what was asked and what came back; blocks show the few fields that matter, not the whole payload. Input keys: ${shape.inputKeys.join(', ') || '(none)'}.`,
    `After writing the file, run \`agent-viewer cards check ${dir}/${id}.json\` and fix anything it reports, then \`agent-viewer cards preview ${id}\` to see what the samples will draw. Do not enable the rule: I do that after reviewing the preview.`,
    samples,
  ].join('\n\n')
}
