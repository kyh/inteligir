# @repo/workspace — the library's page

The SPA the Worker serves at `/library`: the account's library read and written
online through `/v1`, each read a TanStack query under oRPC's own key, which the
account's socket invalidates as writes land, and each write a mutation laid over
what the screens show until the cell answers. It keeps nothing on the device.
Signed out, it sends the tab to the site's sign-in, which brings it back. It
reaches neither the Worker's source nor the shell's: the Worker copies its build
into its assets ([`apps/web`](../web/README.md)), and the Mac app's window loads
it from the site ([`apps/desktop`](../desktop/README.md)).

```
src/main.tsx        opens the session and the account's socket, and mounts the router
src/router.tsx      the router and the QueryClient it carries as context
src/routes/         TanStack Router file routes under the /library basepath:
                    the workspace, and Settings drawn over it
src/app/cloud/      the /v1 client and its query utils, the library's queries,
                    the account's socket, the page's library context,
                    "Needs a connection"
src/app/            the workspace: the rail, the grid, the open item, the panel
                    (Info, the agent), the palette, Settings
src/shell/          what the page asks the Mac app's shell: its update, through
                    desktop-bridge.ts, which parses every answer
```

## Running it

```bash
pnpm dev:web    # the Worker on localhost:5174, serving this page's build at
                # /library, rebuilt as it changes (vite build --watch)
```

Sign in at `localhost:5174/app/sign-in` (`AGENTS.md` § "There is no seeded
login" makes the account) and the tab lands in `/library`; reload it after an
edit. The page runs through the Worker's own route and policy, as a deploy
does (`packages/service/src/library/library-page.ts`). The Mac app's window is a
tab of the same page; only its updater is the shell's, and a tab's Settings
says updates come with the Mac app. `desktopBridge()` in
`src/shell/desktop-bridge.ts` says where the page runs.

## Tests

`pnpm --filter @repo/workspace test` runs the page's own suites under jsdom,
compiled by the React Compiler as the bundle is, and fails any test that logs a
`console.error` (`src/app/test-support/console-error-gate.ts`). The shell's
update commands answer through Tauri's own IPC mock
(`src/app/update-notice.test.tsx`). The page against a real Worker is the
e2e's: `browser-smoke`, `library-browser`, `sync-conflict-browser` and the other
`*-browser` scenarios sign in to the built Worker and drive the tab
(`tools/e2e/src/harness/library-tab.ts`).
