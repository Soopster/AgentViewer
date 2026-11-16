---
name: agent-viewer-themes
description: Create or change an Agent Viewer theme (Web CSS variables and/or OpenTUI palette) as a bundled theme-pack entry or as a mod in the user's plugin directory. Use when asked to add, port, tweak or ship a color scheme, a theme pack, or a transcript view preset for the Web app or the terminal UI.
---

# Agent Viewer themes

A theme is **data**, not code. The host ships only `dark`, `light` and the TUI's
`terminal-palette`; every other theme is an entry in a plugin's `themes` list.
One entry can carry the Web look, the terminal look, or both, and it is offered
only on the renderers it carries. For plugin authoring in general, read the
`agent-viewer-plugins` skill; this one covers what is specific to themes.

## Choose where it goes

- **A theme for this checkout** → add an entry to a pack in
  `plugins/themes-classic|brand|material|terminal/manifest.ts`, or start a new
  pack (below). Packs appear under **Themes** in both plugin managers and can be
  switched off as a unit.
- **A theme for one user's machine** → a mod: `plugin.json` in
  `$AGENT_VIEWER_PLUGINS_DIR` (else `~/.config/agent-viewer/plugins/<id>/`) with
  a `themes` list and nothing else. `agent-viewer mods create <id>` scaffolds the
  folder; delete what you do not need. No build step, no code.

## The entry

```ts
{ id: 'dusk', label: 'Dusk', category: 'dark', icon: '☾',
  css: '--bg: #14121f; --surface: #1b1829; …',          // Web
  tui: { swatch: { bg: '#14121f', text: '#e8e4f5', muted: '#9a93b8', accent: '#9d8cff', warm: '#ffb86b' } } }  // terminal
```

- `id`: lowercase letters, digits, `-` (the terminal also allows `_` and `+`).
  A mod's ids are prefixed `<mod>-` automatically. Built-in ids (`dark`,
  `light`) can never be replaced.
- `category` (`dark` | `light`) places it in the right menu group **and drives
  `color-scheme` and native widgets** (`[data-theme-category]`). Get it right;
  never write a `color-scheme` rule yourself.
- Menus sort by label inside each group, so registration order does not matter.
- `icon` is one glyph (default `◆`); use BMP glyphs only.

### Web: `css`

Bare declarations; the host wraps them in `[data-theme="<id>"] { … }`. Define the
whole vocabulary, because anything you omit falls back to the dark defaults and
the theme looks half-applied:

`--bg --surface --surface-2 --surface-3` (stepped backgrounds) · `--border
--border-2` · `--text --text-2 --text-3` (primary, secondary, tertiary) ·
`--violet --violet-glow --cyan --cyan-glow` (accents; glows may be `transparent`)
· `--green --red --amber` (semantic) · `--t-bash --t-edit --t-write --t-read
--t-grep --t-glob --t-agent --t-other` (one colour per tool card; `--t-bookmark`
defaults to `--amber`). `color-mix(in srgb, …)` and `var(--x)` are fine, which is
how `themes-material` derives a whole theme from five `--material-*` colours.

A bundled entry may also set `rules`: full extra CSS for that theme (a body
backdrop, a restyled message list, as `imessage` does). Use it sparingly and
scope every selector under `[data-theme="<id>"]`. **A mod's `rules` is ignored**,
and a mod's `css` is refused if it contains `{ } < > @`, backslashes or `url(`.

### Terminal: `tui`

Give either a `swatch` (five `#rrggbb` colours; every other colour is derived,
like the generated themes) or a full `palette` of 19 colours: `bg surface surface2
surface3 diffAddBg diffRemoveBg diffMetaBg border border2 text muted dim violet
cyan green red amber pink userBg`. Prefer a swatch unless the derived surfaces
look wrong. Optional `label` (menu text, defaults to the label in capitals),
`description`, and `menu: 'omz'` to list it under the prompt-theme group.

## A new pack

Copy `plugins/themes-brand/manifest.ts`: `id: 'themes-<name>'`, `group: 'Themes'`,
`surfaces: []`, `commands: []`, `themes: [...]`, `renderers` listing only the
renderers its themes cover. Add one import and one array entry in
`lib/plugins/catalog.ts`. No loaders, unions, `globals.css` or `tui/theme.ts`
edits are needed anywhere.

## Quality bar

- Body text on `--bg`/`--surface` ≥ 4.5:1; `--text-2` ≥ 3:1; `--text-3` is decoration.
  Diff add/remove backgrounds must stay distinguishable from `--surface`.
- Check contrast numerically rather than by eye, for the terminal palette too
  (`text`/`muted` on `bg`, `surface`, `userBg`).
- Do not copy a brand's logo or trademarked assets; colours only.

## Verify

1. `npx tsc --noEmit` and `npm run tui:check`.
2. `bun run scripts/themeRegistrySmoke.ts` (registry, mod parser, menu order,
   pack toggling). For a mod: `agent-viewer mods check <path> --json`.
3. Web: run `npm run dev`, pick the theme in the theme menu, and look at the
   transcript, a diff, a tool card and a native `<select>`. Reload to confirm it
   paints on the first frame. Disable its pack and confirm the app falls back to
   the default without errors.
4. TUI: `npm run tui`, open the theme menu, check it is in the right group, and
   look at a transcript with a diff and a permission card. A stored theme whose
   plugin is off must fall back to light and return when the plugin is back.
5. Report which of these you actually ran; a typecheck does not show a theme.

## Related data contributions

Themes sit beside two other data-only contributions a mod can ship in the same
`plugin.json`: `transcriptViews` (below) and `blocks` (a regex that turns text in
a message into a card). See the `agent-viewer-plugins` skill's
`references/extension-points.md` for their limits.

## Transcript view presets

A plugin or mod may also ship `transcriptViews`: `{ id, name, base, overrides }`
where `base` is a built-in view (not `engineering`) and `overrides` are ViewSpec
fields from `tui/viewSpec.ts`. They show read-only beside the user's own views,
as `<plugin>.<id>`; unknown fields and values are dropped, and saving one in the
View Studio makes the user a copy.
