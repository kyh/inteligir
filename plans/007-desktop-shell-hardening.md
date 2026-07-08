# Plan 007: Desktop shell hardening — navigation guard + symlink-safe vault confinement

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- apps/desktop/src/main/index.ts packages/features/src/server/vault/vault.ts`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (defense-in-depth)
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

Two hardening gaps. (1) The main window denies popups but has no
`will-navigate`/`will-redirect` guard, so in-frame content (a crafted link in
a note or agent output) can navigate the app window itself to an arbitrary
origin — phishing surface inside the product chrome. (2) Vault path
confinement is lexical-only; a symlink planted INSIDE the vault (by git,
Dropbox, or any tool that writes there) lets every renderer-driven IPC file op
(read/write/delete/rename) escape the vault root. The code comment accepts
this residual, but the `realPath` machinery to close it already exists in the
same file — closing it is cheap and removes a whole class of renderer-compromise
escalation.

## Current state

- `apps/desktop/src/main/index.ts` (~:190-206) — hardened webPreferences, then:

  ```ts
  window.webContents.setWindowOpenHandler((details) => {
    if (isHttpUrl(details.url)) {
      void shell.openExternal(details.url);
    }
    return { action: "deny" };
  });
  ```

  No `will-navigate` / `will-redirect` handlers anywhere under
  `apps/desktop/src/main` (verified by grep). The window loads either the dev
  server URL (electron-vite HMR) or a packaged `file://` URL — find the exact
  `loadURL`/`loadFile` call in this file to know both origins.

- `packages/features/src/server/vault/vault.ts` (~:265-277):

  ```ts
  // Lexical confinement: resolve the request against the root and require it to
  // stay inside. Rejects `..` traversal and absolute escapes ("/etc/passwd"
  // resolves outside root). Residual: a symlink planted inside the vault could
  // still point out, but the user owns the vault and the agent already has raw
  // fs access, so this guards the renderer path, not the agent.
  private resolve(rel: string): string {
    const root = path.resolve(this.getRoot());
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the vault: ${rel}`);
    }
    return target;
  }
  ```

  The same file already has a `realPath`-style helper used by `setRoot`
  (locate it — the audit places it around vault.ts:364-384) that resolves
  symlinks to guard `~/.inteligir`; reuse its approach.

- Existing confinement tests live in
  `packages/features/src/server/vault/__tests__/vault.test.ts` (temp-dir
  vaults; there are already path-confinement cases — model the new ones on
  those). NOTE for tests on macOS: `/tmp` is itself a symlink to
  `/private/tmp`, so the vault ROOT must be realpath'd before comparisons or
  every test fails spuriously.

## Commands you will need

| Purpose        | Command                             | Expected |
| -------------- | ----------------------------------- | -------- |
| Features tests | `pnpm --filter @repo/features test` | pass     |
| Typecheck/lint | `pnpm typecheck && pnpm lint`       | exit 0   |
| Real app       | `pnpm dev:desktop` (CDP on :9222)   | boots    |

## Scope

**In scope**:

- `apps/desktop/src/main/index.ts`
- `packages/features/src/server/vault/vault.ts`
- `packages/features/src/server/vault/__tests__/vault.test.ts`
- `plans/README.md`

**Out of scope**:

- The agent's filesystem access (pi tools via `./vault`) — intentionally
  unconfined, equals the user; the comment says so and it stays true.
- webPreferences — already hardened, don't touch.
- The preload / Bridge surface.

## Git workflow

- Branch: `kyh/plan-007-shell-hardening`
- Commits: `fix(desktop): block top-level navigation away from the app` and
  `fix(vault): symlink-safe path confinement on the IPC surface`

## Steps

### Step 1: Navigation guard

In `createWindow` (main/index.ts), after the `setWindowOpenHandler` block:

```ts
const allowedOrigin = new URL(<the URL the window loads>).origin; // dev server or file:
window.webContents.on("will-navigate", (event, url) => {
  if (new URL(url).origin === allowedOrigin) return;
  event.preventDefault();
  if (isHttpUrl(url)) void shell.openExternal(url);
});
```

Also handle `will-redirect` with the same logic. For the packaged build the
app origin is `file://` (origin `"null"` for file URLs in some Electron
versions — test both dev and packaged expectations; comparing
`url.startsWith(loadedUrlPrefix)` is an acceptable alternative to origin
comparison if origin proves unreliable for file URLs). HMR dev-server
navigations (same origin) must keep working.

**Verify**: `pnpm typecheck` → exit 0; then `pnpm dev:desktop`, open a note
containing `[link](https://example.com)`, click it → opens in the system
browser, app window does NOT navigate.

### Step 2: Symlink-safe resolve()

Extend `resolve()` in vault.ts: after the existing lexical check, resolve the
target's symlinks and re-verify confinement. The target may not exist yet
(writes create files), so realpath the NEAREST EXISTING ancestor:

- Walk from `target` upward to the first existing path; `fs.realpathSync` it;
  re-join the non-existing remainder; require the result to satisfy the same
  `=== realRoot || startsWith(realRoot + sep)` check against a realpath'd
  root. Reuse/extract the existing realPath helper logic rather than writing a
  second one.
- On failure, throw the same `Path escapes the vault` error shape.
- Update the block comment: the residual is closed; the guard now covers
  symlinks planted inside the vault.

Performance note: this adds syscalls to every IPC file op. One
`realpathSync` per op is acceptable; do NOT add caching in this plan.

**Verify**: `pnpm --filter @repo/features test` → existing vault tests pass

### Step 3: Tests

In `vault.test.ts`, temp-dir pattern (realpath the root in setup — macOS
`/tmp` note above):

1. Symlink inside vault → file outside: `readText` through the link throws
   `Path escapes the vault`.
2. Symlink inside vault → directory outside: `writeText("link-dir/x.md")`
   throws.
3. Symlink inside vault → another file INSIDE the vault: still allowed
   (must not over-block).
4. Non-existent path inside the vault (plain create) still writes fine.
5. Existing traversal cases still pass unchanged.

**Verify**: `pnpm --filter @repo/features test` → all pass, ≥4 new tests

### Step 4: Gates

`pnpm format:fix` then full gate:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

## Done criteria

- [ ] `will-navigate` + `will-redirect` guards exist; external links open externally (manually verified in dev:desktop)
- [ ] Symlink-escape tests pass; in-vault symlinks still work
- [ ] Full gate exits 0; `plans/README.md` updated

## STOP conditions

- `resolve()` or the window-open handler don't match the excerpts (drift).
- The vault watcher or sync round-trips break under the realpath'd resolve
  (paths reported by the watcher may be un-realpath'd — if the vault root
  itself is behind a symlink and existing tests break, report; do not paper
  over by realpath-ing in some call sites only).
- Dev HMR breaks under the navigation guard.

## Maintenance notes

- If a "open vault in iCloud/Dropbox" support path ever legitimately places
  the vault BEHIND a symlink, the root-realpath in Step 2 handles it — but
  add a test then.
- Reviewer: check Step 2 against `rename()` — both `from` and `to` go through
  `resolve()`; confirm the nearest-existing-ancestor logic is right for the
  not-yet-existing `to`.
