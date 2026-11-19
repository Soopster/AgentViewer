# Workflow Packs

Open **Workflow Packs** from the palette to preview and install reusable
repository playbooks. Web and OpenTUI offer the same packs and JSON import. The
view can be a panel, window, or overlay.

Included packs:

- Deliberate Development: research/plan, implementation, independent verification,
  and delivery with proposed lessons for human review.
- Systematic Debugging: reproduce, diagnose, fix, and verify.
- Test-driven Development: red, green, refactor, and independent verification.
- Review Council: independent correctness, security, and performance reviews,
  followed by one consolidated report. Its task instructions are read-only.

These are original, provider-neutral templates inspired by
[Superpowers](https://github.com/obra/superpowers) and
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin).
They use the existing Coordinator task/phase contracts and `{{args}}` binding.
Their names begin with `pack-` to distinguish them from existing project workflows.
They do not install those projects' native hooks or skill packages.

Select a pack and inspect its phases, task instructions, agent count, review/plan
gates, declared commands, and full playbook definitions. **Preview installation**
compares it against the selected repository's playbooks:

- missing: can be installed;
- installed: matches the current pack definition;
- customized: an existing local workflow differs and is kept;
- invalid: an existing file cannot be parsed and is kept for inspection.

**Install missing workflows** writes only missing definitions. Repeating an
installation resumes missing work and preserves installed/customized files.
Create-only playbook writes atomically refuse concurrent collisions. Inspect and
edit installed files through the existing Playbooks manager. Workflow definitions
live under `.agent-viewer/playbooks/` and can be versioned with the project.

Installation starts no agents and runs no declared commands. To execute a workflow,
open **Start coordinated run**, select the installed playbook, supply task arguments,
and review its provider/account and run settings there.

For your own pack, choose **Import pack JSON**. Format:

```json
{
  "id": "team-reviews",
  "title": "Team Reviews",
  "version": "1.0.0",
  "description": "Our repository's review workflow",
  "sources": [],
  "playbooks": [{
    "name": "pack-team-review",
    "description": "Read-only review",
    "phases": [{
      "title": "Inspect",
      "tasks": [{
        "title": "Review the requested scope",
        "detail": "Review {{args}}. Return evidence-backed findings without modifying files.",
        "role": "lead"
      }]
    }]
  }]
}
```

Imports accept at most 20 playbooks / 200 tasks and 250,000 JSON characters.
Definitions use the existing RunPlaybook validator. Declared commands are data
until the user starts a run; inspect imported definitions before installation.

OpenTUI: j/k chooses a pack, p previews, i installs missing workflows, e edits
imported JSON, f toggles the full definition, and Escape closes. Ctrl+S leaves the
JSON editor.

Validation: `npm run workflow-packs:smoke`, `npm run knowledge-plugins:tui:smoke`,
and `npm run knowledge-plugins:web:smoke`. These use real repository playbook files
and check customized/invalid/concurrent-file preservation. They do not launch live
Coordinator/provider runs.

## OpenTUI workspace

Packs appear in a compact list beside Overview, Stages, Install and Definition
tabs. Overview summarizes workflows and their requirements. Stages lets you
select a phase to inspect task roles, dependencies, instructions and verification
commands. Install holds the repository preview and the action to install missing
workflows. Changing packs invalidates the previous preview. Definition shows the
full JSON. Import JSON opens a separate editor and retains input when you leave it.

Tab switches pane focus; 1/2 selects the pack list/details; left/right changes
tabs; j/k selects a pack or stage, or scrolls content. Page Up/Down scrolls
details, including long stage tasks. Enter opens a pack, Ctrl+N
toggles the list, p previews, i installs from the Install tab, f toggles the full
definition, and e edits imported JSON. ? opens bounded, scrollable help that
captures input without resizing the workspace. Narrow panels switch between
pack list and detail. Installation creates templates and starts no agents.
