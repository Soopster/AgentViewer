// Which state is a coding agent in, from the text of its terminal screen?
//
// herdr classifies a pane by ordered rules per agent (src/detect/manifests/*.toml:
// a region of the screen, a predicate, a priority; the highest priority that
// matches wins). This is the part of that engine a screen of text needs, as pure
// data and one pure function, so a captured screen is classified the same way in
// the TUI, in `agent-viewer session explain`, and in a smoke.
//
// **A rule that matches too much is worse than none.** A user's own prompt can
// say "esc to cancel", so every blocked rule names its region and the footer
// shape that only the agent draws. A screen no rule matches is `unknown`, never
// a guess: the caller keeps whatever state it last knew.
const RULE_LINE = /^[\s]*[─━═\-_]{3,}[\s]*$/;
function regionText(screen, region) {
    const filled = screen.lines.filter((line) => line.trim() !== '');
    if (region.kind === 'title')
        return screen.title ? [screen.title] : [];
    if (region.kind === 'whole')
        return [...screen.lines];
    if (region.kind === 'bottom')
        return filled.slice(-region.lines);
    if (region.kind === 'top')
        return filled.slice(0, region.lines);
    const lastRule = screen.lines.map((line, index) => (RULE_LINE.test(line) ? index : -1)).filter((index) => index >= 0).pop();
    return lastRule === undefined ? [] : screen.lines.slice(lastRule + 1);
}
const compiled = new Map();
function compile(source, flags) {
    const key = `${flags}/${source}`;
    if (!compiled.has(key)) {
        try {
            compiled.set(key, new RegExp(source, flags));
        }
        catch {
            compiled.set(key, null);
        }
    }
    return compiled.get(key) ?? null;
}
function holds(predicate, lines) {
    const text = lines.join('\n');
    const lower = text.toLowerCase();
    if (predicate.contains && !predicate.contains.every((needle) => lower.includes(needle.toLowerCase())))
        return false;
    if (predicate.regex) {
        const pattern = compile(predicate.regex, 'im');
        if (!pattern || !pattern.test(text))
            return false;
    }
    if (predicate.lineRegex) {
        const pattern = compile(predicate.lineRegex, 'i');
        if (!pattern || !lines.some((line) => pattern.test(line)))
            return false;
    }
    if (predicate.any && !predicate.any.some((inner) => holds(inner, lines)))
        return false;
    if (predicate.all && !predicate.all.every((inner) => holds(inner, lines)))
        return false;
    if (predicate.not && predicate.not.some((inner) => holds(inner, lines)))
        return false;
    return true;
}
/** The highest-priority rule that matches, or `unknown` with no rule. Ties go to the earlier rule. */
export function classifyScreen(manifest, screen) {
    let best = null;
    for (const rule of manifest.rules) {
        if (best && rule.priority <= best.priority)
            continue;
        if (holds(rule, regionText(screen, rule.region)))
            best = rule;
    }
    return best
        ? { state: best.state, ruleId: best.id, keepState: best.keepState === true }
        : { state: 'unknown', ruleId: null, keepState: false };
}
/** Why a screen was classified as it was: every rule that matched, best first. */
export function explainScreen(manifest, screen) {
    const matched = manifest.rules
        .filter((rule) => holds(rule, regionText(screen, rule.region)))
        .map((rule) => ({ id: rule.id, state: rule.state, priority: rule.priority }))
        .sort((a, b) => b.priority - a.priority);
    return { winner: classifyScreen(manifest, screen), matched };
}
const CLAUDE_SPINNERS = '[\\u2800-\\u28FF\\u25D0-\\u25D3]';
const CLAUDE_STARS = '[*\\u00B7\\u2722\\u2733\\u2736\\u273B\\u273D]';
// Rule shapes follow herdr's claude and codex manifests (Apache-2.0), reduced to
// the signals that were checked against real screens there.
export const CLAUDE_MANIFEST = {
    id: 'claude',
    aliases: ['claude-code'],
    rules: [
        { id: 'osc_title_working', state: 'working', priority: 1100, region: { kind: 'title' }, regex: `^${CLAUDE_SPINNERS} ` },
        { id: 'live_turn_working', state: 'working', priority: 970, region: { kind: 'bottom', lines: 12 }, any: [
                { lineRegex: '^\\s*[⏸⏵].*esc to interrupt(?:\\s|·|$)' },
                { lineRegex: `^\\s*${CLAUDE_STARS}\\s+\\S.*…(?:\\s+\\(\\d+[smh](?:\\s|·)|\\s*$)` },
            ] },
        { id: 'transcript_viewer', state: 'unknown', keepState: true, priority: 1000, region: { kind: 'bottom', lines: 3 }, contains: ['showing detailed transcript'] },
        { id: 'live_blocked_form', state: 'blocked', priority: 980, region: { kind: 'after-last-rule' }, contains: ['esc to cancel'], any: [
                { contains: ['enter to confirm'] },
                { contains: ['enter to select'], any: [{ contains: ['arrow keys to navigate'] }, { contains: ['↑/↓ to navigate'] }, { contains: ['↑↓ to navigate'] }, { contains: ['arrows to navigate'] }] },
            ] },
        { id: 'bash_permission_prompt', state: 'blocked', priority: 850, region: { kind: 'bottom', lines: 25 }, contains: ['do you want to proceed?'], any: [
                { contains: ['bash command'] }, { contains: ['tab to amend'] }, { contains: ['ctrl+e to explain'] }, { contains: ['yes, and don'] },
            ] },
        { id: 'live_prompt_box', state: 'idle', priority: 950, region: { kind: 'bottom', lines: 8 }, // `❯ 1. Yes` is a menu's selection cursor, not the prompt box.
            lineRegex: '^\\s*[│|]?\\s*❯(?!\\s*\\d+\\.)', not: [
                { contains: ['do you want to proceed?'] }, { contains: ['enter to select'] }, { contains: ['esc to cancel'] }, { contains: ['arrow keys to navigate'] },
            ] },
    ],
};
export const CODEX_MANIFEST = {
    id: 'codex',
    rules: [
        { id: 'osc_title_blocked', state: 'blocked', priority: 1100, region: { kind: 'title' }, contains: ['Action Required'] },
        { id: 'osc_title_working', state: 'working', priority: 1050, region: { kind: 'title' }, regex: '(?:^| )[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?: |$)' },
        { id: 'trust_directory', state: 'blocked', priority: 950, region: { kind: 'top', lines: 20 }, any: [
                { regex: 'Do\\s+you\\s+trust\\s+the\\s+contents\\s+of\\s+this\\s+directory\\?' },
                { contains: ['Trust this folder?', 'Codex can read, edit, and run files here'] },
            ] },
        { id: 'approval_prompt', state: 'blocked', priority: 900, region: { kind: 'bottom', lines: 20 }, any: [
                { contains: ['would you like to run the following command?'] },
                { contains: ['do you want to approve'] },
                { contains: ['press enter to confirm or esc to cancel'] },
            ] },
        { id: 'working_status', state: 'working', priority: 800, region: { kind: 'bottom', lines: 12 }, lineRegex: '\\besc to interrupt\\b' },
        { id: 'composer_idle', state: 'idle', priority: 500, region: { kind: 'bottom', lines: 8 }, lineRegex: '^\\s*[│|]?\\s*›', not: [{ contains: ['esc to interrupt'] }] },
    ],
};
export const AGENT_MANIFESTS = [CLAUDE_MANIFEST, CODEX_MANIFEST];
export function findAgentManifest(name) {
    const wanted = name.toLowerCase();
    return AGENT_MANIFESTS.find((manifest) => manifest.id === wanted || manifest.aliases?.includes(wanted)) ?? null;
}
/** The manifest for whatever program a terminal is running, by executable name. */
export function manifestForProgram(program) {
    const base = program.split(/[\\/]/).pop()?.toLowerCase().replace(/\.(exe|cmd)$/, '') ?? '';
    return findAgentManifest(base);
}
/**
 * The agent a screen belongs to when the program is not known: every manifest
 * classifies it and the rule with the highest priority wins. Rules name footers
 * only their own agent draws, so a screen another agent owns matches nothing here.
 */
export function classifyAnyAgent(screen) {
    let best = null;
    for (const manifest of AGENT_MANIFESTS) {
        const detection = classifyScreen(manifest, screen);
        if (!detection.ruleId)
            continue;
        const priority = manifest.rules.find((rule) => rule.id === detection.ruleId)?.priority ?? 0;
        if (!best || priority > best.priority)
            best = { agent: manifest.id, detection, priority };
    }
    return best ? { agent: best.agent, detection: best.detection } : null;
}
