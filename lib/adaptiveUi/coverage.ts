// Does a rule actually find what it reads? A card that looks right on the one payload it was designed
// against can read most fields as empty on real ones. This runs a rule over the calls it has samples for and
// reports, per binding, how often it came up empty, and whether results were JSON at all.
import { evaluateBinding, ruleBindingPaths, type CardRule, type CardRuleContext } from '../plugins/cardTemplates'

export type BindingCoverage = { readonly path: string; readonly checked: number; readonly empty: number }
export type RuleCoverage = {
  readonly calls: number
  readonly bindings: readonly BindingCoverage[]
  /** Calls whose result was not JSON although the rule reads result.json.*. */
  readonly notJson: number
  /** What to tell the person, worst first; empty when the rule reads everything it reads. */
  readonly warnings: readonly string[]
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === ''

export function ruleCoverage(rule: CardRule, calls: readonly CardRuleContext[]): RuleCoverage {
  const paths = ruleBindingPaths(rule)
  const readsJson = paths.some(path => path.startsWith('result.json'))
  const bindings = paths.map(path => {
    // A call with no result yet says nothing about result.* bindings.
    const relevant = calls.filter(call => !path.startsWith('result.') || call.result)
    return { path, checked: relevant.length, empty: relevant.filter(call => isEmpty(evaluateBinding(path, call))).length }
  })
  const withResult = calls.filter(call => call.result)
  const notJson = readsJson ? withResult.filter(call => isEmpty(evaluateBinding('result.json', call))).length : 0
  const warnings: string[] = []
  if (readsJson && withResult.length && notJson === withResult.length) warnings.push(`the result is not JSON in ${notJson === 1 ? 'the sample' : `all ${notJson} samples`}, so every result.json field reads empty: use result.text`)
  else if (notJson) warnings.push(`the result is not JSON in ${notJson} of ${withResult.length} samples`)
  if (!(readsJson && notJson === withResult.length)) for (const binding of [...bindings].sort((a, b) => b.empty / (b.checked || 1) - a.empty / (a.checked || 1))) if (binding.checked && binding.empty) warnings.push(`${binding.path} is empty in ${binding.empty} of ${binding.checked} samples`)
  return { calls: calls.length, bindings, notJson, warnings }
}

/** The calls a rule's stored samples stand for. */
export function sampleCalls(rule: CardRule): CardRuleContext[] {
  return (rule.samples ?? []).map(sample => ({ tool: { name: rule.match.tool.replace(/\*/g, 'x'), input: sample.input }, ...(sample.result ? { result: { text: sample.result.text, isError: sample.result.isError === true } } : {}) }))
}
