# Plan 005: Extract and unit-test the Electron main-process navigation/origin guard

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/desktop/src/main/index.ts apps/desktop/src/__tests__`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

`apps/desktop/src/main/index.ts` is the highest-churn file in the repo (102 commits since 2026-05-01) and has **zero** tests. It holds the navigation/origin guard that pins the app window to its own origin — the last line of defense against a crafted link in a note or agent output navigating the product chrome to a phishing page, and part of the boundary the sandboxed HTML-app runtime sits behind. Every one of those commits shipped on typecheck alone. The origin-compare logic is subtle (true-origin comparison to defeat `localhost:5173.evil.com`, `file://` opaque-origin handling for the packaged bundle) — exactly the kind of code that regresses silently. Extracting it to a pure, importable function and pinning the URL matrix makes the boundary regression-proof at near-zero risk.

## Current state

- `apps/desktop/src/main/index.ts:248-275` — the guard, currently a closure inside the window-creation function (`loadedUrlPrefix` is closed over, set at load time):

```ts
let loadedUrlPrefix = "";
const isSameOrigin = (candidate: string): boolean => {
  if (loadedUrlPrefix.length === 0) return false;
  let parsed: URL;
  let loaded: URL;
  try {
    parsed = new URL(candidate);
    loaded = new URL(loadedUrlPrefix);
  } catch {
    return false; // unparseable → not same origin
  }
  if (loaded.protocol === "file:") {
    return (
      parsed.protocol === "file:" &&
      (candidate === loadedUrlPrefix || candidate.startsWith(loadedUrlPrefix + "#"))
    );
  }
  return parsed.origin === loaded.origin;
};
const guardNavigation = (event: Electron.Event, url: string): void => {
  if (isSameOrigin(url)) return;
  event.preventDefault();
  if (isHttpUrl(url)) {
    void shell.openExternal(url);
  }
};
window.webContents.on("will-navigate", guardNavigation);
window.webContents.on("will-redirect", guardNavigation);
```

- `isHttpUrl` is imported from `@repo/features/ipc` (`index.ts:32`).
- The existing main-process test (`apps/desktop/src/__tests__/vault-app-protocol.test.ts:1-25`) shows the established pattern for testing main code: `vi.mock("electron", () => ({...}))` at top, then import the pure helper and drive it. `@/` and `@/main/` path aliases resolve in that suite. Use the SAME pattern.
- The window is created with correct hardening already (verified, do not change): `contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true` (`index.ts:220-226`); `setWindowOpenHandler` denies all and routes http(s) to `shell.openExternal` (`index.ts:229-234`).
- Naming: kebab-case for all TS files (repo rule).

## Commands you will need

| Purpose       | Command                                                                              | Expected |
| ------------- | ------------------------------------------------------------------------------------ | -------- |
| Format        | `pnpm format:fix` (FIRST)                                                            | exit 0   |
| Typecheck     | `pnpm typecheck`                                                                     | exit 0   |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                   | all pass |
| Full gates    | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- `apps/desktop/src/main/navigation-guard.ts` (create — the extracted pure logic)
- `apps/desktop/src/main/index.ts` (import + use the extracted function; wire the events)
- `apps/desktop/src/__tests__/navigation-guard.test.ts` (create)

**Out of scope**:

- The window `webPreferences` hardening — correct, leave untouched.
- `setWindowOpenHandler` — already correct; testing it needs an Electron mock harness and is a separate, lower-value effort. This plan covers the navigation/origin guard only.
- Any change to `shell.openExternal` gating behavior — preserve it exactly.
- The before-quit flush / render-process-gone handlers — out of scope for this plan (they need a heavier lifecycle harness; note as deferred follow-up).

## Git workflow

- Branch: `kyh/plan-005-navigation-guard-tests`
- Conventional commit, e.g. `test(desktop): extract and unit-test the navigation origin guard`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract the pure origin check

Create `apps/desktop/src/main/navigation-guard.ts` exporting a pure function:

```ts
/** True when `candidate` is on the same origin as the loaded app URL.
 * `loadedUrlPrefix` is the exact URL the window loaded (the dev-server URL in
 * dev, the packaged file:// bundle in prod). http(s) compares true URL origins
 * so a prefix like "http://localhost:5173" cannot be spoofed by
 * "http://localhost:5173.evil.com"; file: URLs all parse to the opaque origin
 * "null", so the packaged bundle is matched by exact URL (plus a "#fragment"
 * suffix for in-page anchors). */
export function isSameAppOrigin(candidate: string, loadedUrlPrefix: string): boolean {
  // (move the body from index.ts verbatim, taking loadedUrlPrefix as a param)
}
```

Move the exact logic from `index.ts`. Do not change behavior — this is a lift, not a rewrite.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Use it in index.ts

In `index.ts`, delete the inline `isSameOrigin` closure and call `isSameAppOrigin(url, loadedUrlPrefix)` from `guardNavigation`. Keep `loadedUrlPrefix` as the closure variable set at load time and the two `webContents.on(...)` wirings unchanged.

**Verify**: `pnpm typecheck` → exit 0; `grep -n "isSameAppOrigin" apps/desktop/src/main/index.ts` → present; `grep -n "const isSameOrigin" apps/desktop/src/main/index.ts` → gone.

### Step 3: Test the origin matrix

Create `apps/desktop/src/__tests__/navigation-guard.test.ts` (no electron mock needed — the function is pure). Cover:

- Empty `loadedUrlPrefix` → always false (guard treats "not loaded yet" as block).
- Dev http origin: `isSameAppOrigin("http://localhost:5173/x", "http://localhost:5173")` → true; `"http://localhost:5173.evil.com"` → **false** (the spoof case); `"http://localhost:6006"` → false; `"https://localhost:5173"` → false (scheme differs).
- Packaged file: `loaded = "file:///Applications/Inteligir.app/.../index.html"`: exact match → true; same URL + `#section` → true; a different `file://` path → false; an `http(s)` URL → false.
- Unparseable candidate (`"::::"`) → false.
- `javascript:`/`data:` scheme candidate → false.

**Verify**: `pnpm --filter @repo/desktop test` → all pass, including the new file.

### Step 4: Gates

`pnpm format:fix`, then full gates.

**Verify**: exit 0.

## Test plan

Single new pure-function test file (Step 3). No Electron harness required because the extraction removed the Electron dependency from the logic under test. Model file structure after any existing `apps/desktop/src/__tests__/*.test.ts`. The matrix above is the full case list; the load-bearing case is the `.evil.com` suffix spoof returning false.

## Done criteria

- [ ] `apps/desktop/src/main/navigation-guard.ts` exists and is pure (no `electron`/`shell` import)
- [ ] `index.ts` imports and uses it; the inline closure is gone
- [ ] New test file covers all matrix cases including the suffix-spoof case
- [ ] `pnpm --filter @repo/desktop test` green; full gates green
- [ ] `plans/README.md` updated

## STOP conditions

- Extracting `isSameAppOrigin` changes any observed behavior (the test matrix must pass with the logic moved verbatim; if a case surprises you, the guard may have a latent bug — report it, don't "fix" it silently in this test-only plan).
- `knip` flags the new export as unused (means index.ts isn't actually calling it — wire it before finishing).
- The `@/main/` alias doesn't resolve for the new module in the test env — check the vault-app-protocol test's imports and mirror them.

## Maintenance notes

- Deferred (not in this plan): a lifecycle harness testing `setWindowOpenHandler` denial, the `before-quit` autosave flush, `render-process-gone` recovery, and html-app token revoke-on-close. Those need an `electron` mock modeling `BrowserWindow`/`app` events — worth a follow-up plan given the file's churn.
- Reviewer: confirm the guard is still wired to BOTH `will-navigate` and `will-redirect` (a redirect chain is a common bypass).
- If the app ever loads more than one origin (e.g. an embedded auth page), `isSameAppOrigin` needs an allowlist, not a single prefix — revisit then.
