export const CLAUDE_DIAGNOSTIC_ACTIONS = [
  ['reloadPlugins', 'reload-plugins', 'RELOAD PLUGINS', 'Plugins reloaded.', 'Reload plugins from disk'],
  ['reloadSkills', 'reload-skills', 'RELOAD SKILLS', 'Skills reloaded.', 'Reload skills from disk'],
  ['resolveSettings', 'resolve-settings', 'RESOLVE SETTINGS', 'Settings resolved.', 'Resolve effective Claude settings'],
] as const
export function claudeDiagnosticActionNotice(
  action: string,
  fallback: string,
  result: Record<string, unknown>): string {
  if (action === 'setMcpServers') {
    const authRequired = Array.isArray(result.authRequired)
      ? result.authRequired.filter((name): name is string => typeof name === 'string')
      : []
    const errors = result.errors && typeof result.errors === 'object' && !Array.isArray(result.errors)
      ? Object.keys(result.errors)
      : []
    if (authRequired.length > 0) return `${fallback} Authentication required: ${authRequired.join(', ')}.`
    if (errors.length > 0) return `${fallback} Connection failed: ${errors.join(', ')}.`
    return fallback
  }
  if (action !== 'resolveSettings') return fallback
  const sources = typeof result.sourceCount === 'number'
    ? result.sourceCount
    : Array.isArray(result.sources) ? result.sources.length : null
  const effective = typeof result.effectiveKeyCount === 'number'
    ? result.effectiveKeyCount
    : Array.isArray(result.effectiveKeys) ? result.effectiveKeys.length : null
  if (sources == null && effective == null) return fallback
  return `Settings resolved${sources == null ? '' : ` · ${sources} source${sources === 1 ? '' : 's'}`}${effective == null ? '' : ` · ${effective} effective key${effective === 1 ? '' : 's'}`}`
}
