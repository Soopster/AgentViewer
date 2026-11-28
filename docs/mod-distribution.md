# Versioned local mod packages

Managed packages add pinned installation, updates, removal and rollback without
changing the existing rule that projects never auto-load executable mods.
Package commands require Bun and inspect files without importing package code or
running install scripts. The currently supported source is an explicit local
directory. Clone/download a repository yourself, review its files, then inspect it.
Remote URLs, dependency installation and marketplace discovery are not supported.

## Package identity and compatibility

Managed packages require a semantic `version` in `plugin.json`:

```json
{
  "id": "team-tools",
  "version": "1.2.0",
  "hostApi": { "min": 1, "max": 1 },
  "commands": [{ "id": "hello", "label": "Hello" }]
}
```

`hostApi` is optional. Its inclusive integer bounds refer to the plugin API
version, not the app's marketing version. Unsupported API bounds and malformed
metadata are rejected. Loose user mods may still omit version metadata.

## Inspect, pin and install

```sh
agent-viewer mods inspect ./team-tools
agent-viewer mods install ./team-tools --sha256 <digest-from-inspect>
agent-viewer mods list
agent-viewer mods update team-tools --source ./new-team-tools --sha256 <new-digest>
agent-viewer mods rollback team-tools
agent-viewer mods remove team-tools
```

All successful commands return JSON. Inspect returns the content digest, version,
absolute source directory and file/byte counts. Install/update requires that exact
SHA-256 digest, so a source changed after inspection is refused. Versions must
change on update; the same version cannot silently point at different content.
The digest pins paths, local bytes and executable flags, not publisher identity or trust. Installing a mod
makes its code eligible to run with host permissions after reload/restart.

Copies exclude `.git` and `node_modules`; dependencies must already be bundled
into the mod's source. Symlinks and special files are refused. Limits are 500
files, 10 MiB per file and 32 MiB total. Manifest validation and source syntax
checks run before activation. Export validity and runtime behavior still need
`mods check --render`, author fixtures and real app checks for trusted code.

## Activation and recovery

Content-addressed releases live under `mod-packages/<id>/releases/<sha256>/content`
beside the user plugins directory. The normal plugins directory gets an active
symlink named after the mod. Activation replaces that pointer with one atomic
rename after a complete staged copy. Existing unmanaged directories are never
overwritten or removed. Managed active pointers, release bytes and executable flags must match the
recorded receipt before updates/removal/rollback; local edits require manual
preservation first. `mods list` reports whether an installed package is dirty.

Per-mod locks serialize package mutations. If a process dies, the next operation
can reclaim its lock after confirming that the owner process no longer exists.
A recovery journal reconciles the state record with the atomic pointer after an
interrupted activation. A pointer changed outside the transaction is refused for
manual inspection. Do not edit release content or package state by hand.

Removal deletes only the active pointer. It preserves configuration in
`mod-settings/<id>.json`, retained releases and up to 50 history receipts.
Rollback restores the most recent retained release, including after removal;
rollback twice toggles the active and previous release. Releases are not garbage
collected automatically. Existing running instances keep their loaded code until
an explicit reload or restart; package operations do not interrupt agent runs.

Validation: `bun scripts/modPackagesSmoke.ts` exercises pin mismatch, staged
validation, host compatibility, dirty/unmanaged refusal, update/rollback/removal,
configuration preservation and interrupted-transaction recovery with local files.
It performs no network access or live-provider execution.
