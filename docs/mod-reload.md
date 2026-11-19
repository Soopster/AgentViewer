# Reload local mods

```sh
agent-viewer mods reload
agent-viewer mods reload --dir /absolute/path/to/a/trusted-mod
agent-viewer mods reload --clear-dev
```

Reload is explicit. It writes a revision marker beside the configured user plugin
directory. Live Web tabs and OpenTUI processes sharing that directory apply it on
their next inspection heartbeat, normally within five seconds. A server read can
observe it sooner. The CLI receipt means requested, not that every instance has
already applied it. Offline processes see it on startup.

`--dir` explicitly registers one trusted development mod directory in addition to
installed mods. It replaces the previous development-directory list. That choice
persists in the marker until `--clear-dev`, and applies to all processes using the
same configuration root. Project directories are never scanned automatically.
Installed IDs take precedence; duplicate or invalid declarations are refused with
reasons. Use the plugin managers or `mods status` to inspect actual activation.

Reload refreshes discovery and manifests, cancels outstanding mod capability
lifetimes, evicts behavior/view/command caches, and reloads server entry modules
and custom renderer components on their next activation. Pending stale actions
cannot apply their returned effects. Module deactivation runs once. Already
running provider turns and user-owned processes are not interrupted. Mods must
cooperate with their AbortSignals and cleanup hooks for their own background work.

The runtime copies a bounded trusted mod source tree into a private per-process
revision snapshot before importing its server entry. This gives Bun and Node
fresh real paths for local helper modules and assets as well as the entry, and
leaves installed/source files untouched. Snapshots exclude `.git` and
`node_modules`, refuse source-tree symlinks/special files, and cap copies at
1,000 files, 2,000 entries, 32 MiB total, 10 MiB per file and depth 64. An active
managed-package root symlink is resolved before snapshotting. Snapshot files are
removed at normal process exit; crashes may leave private temporary directories.

`import.meta.url` and `__dirname` in server code point into that snapshot. Assets
are copied; mod-relative writes affect temporary files, not installed source.
Keep durable state at an explicit external location. The nearest original
`node_modules` is linked for dependency resolution. External dependencies remain
shared in the language module cache; restart to reload changed npm dependencies.
Repeated reloads retain snapshot/module entries until process exit, so restart
long-running development processes periodically. This is not a sandbox or a
module-cache unloader.

A malformed updated manifest is refused rather than retaining old executable
contributions. Reload does not alter saved enablement or mod configuration.
`mods reload` does not run source code; normal activation does. Test trusted mods
with `mods check --render` and `mods test` before loading them.

Verification: `bun scripts/modReloadSmoke.ts`, the mod SDK smokes and both
application typechecks. The focused reload smoke checks explicit dev discovery,
changed server code, deactivation, pending-effect cancellation and Web inspection
revision delivery. Renderer focus/layout remains covered by the existing mod
browser and OpenTUI smokes.
