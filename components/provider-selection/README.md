# Provider selection

`useProviderSelection` owns provider restoration, configured instance discovery,
and persisted provider switching. Provider and provider-instance ID form one
state value; consumers never observe a mixed pair from separate setters.

- `adopt(provider, instance)` follows a locally selected session without changing
  the persisted default. It supersedes any pending selection response.
- `select(provider, instance)` persists a default and returns true only when its
  response still represents the current selection intent. The page clears
  navigation only for that result. False means unchanged, busy, failed, or
  superseded; current errors are exposed by the hook.
- The `all` selection always has the local instance key `all` and omits the
  instance from the persisted request.

Restoration runs once per mount. Scope, layout, and catalog refreshes do not
restore the default again. A late restoration response can populate the instance
picker after local navigation, but cannot replace the locally selected target.
Failed restoration exposes an error and permits the default Claude catalog query
so the page can recover.

Persisted writes remain serialized until their responses settle, including when
local navigation has superseded their UI result. Aborting a request cannot undo a
server write. Unmount closes outstanding requests and fences their results.

The browser check mounts the real provider and catalog hooks under StrictMode
with HTTP responses that deliberately ignore cancellation:

```sh
node scripts/webProviderSelectionBrowserSmoke.mjs
npx tsc --noEmit
```

It covers restoration replay, query identity, scope independence, discovery after
local navigation, duplicate switches, serialized writes, superseded completions,
request errors, all-provider mode, and unmount. It does not exercise live providers.

Imperative commands can use `currentTarget()` to capture the latest provider and
instance pair, including a local adoption not yet committed by React. Rendering
continues to use the hook's state snapshot.
