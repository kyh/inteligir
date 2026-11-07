# @repo/workspace — the library's page

The SPA the Worker serves at `/library`: the account's library over a replica
the tab holds, every read from the replica engine (`@repo/library-replica`, on
in-memory SQLite) and every write through its outbox, and what only the cloud
answers (History, the agent, import and export, the account) through `/v1`.
Signed out, it sends the tab to the site's sign-in, which brings it back. It
reaches neither the Worker's source nor the shell's: the Worker copies its build
into its assets ([`apps/web`](../web/README.md)), the desktop shell embeds the
same build ([`apps/desktop`](../desktop/README.md)), and the page talks to each
over its wire.

```
src/main.tsx        opens the session, then the replica, and mounts the router
src/router.tsx      the router and the QueryClient it carries as context
src/routes/         TanStack Router file routes under the /library basepath:
                    the workspace, and Settings drawn over it
src/app/cloud/      the /v1 client and its query utils, the replica's queries,
                    the page's library context, "Needs a connection"
src/app/            the workspace: the rail, the grid, the open item, the panel
                    (Info, Highlights, History, the agent), the palette, Settings
src/shell/          what the page says to the Tauri shell: one command per row of
                    ipc-contract.ts, and shell-commands.ts, the one door that
                    parses every answer
```

## Running it

```bash
pnpm dev:web    # the Worker on localhost:5174, serving this page's build at
                # /library, rebuilt as it changes (vite build --watch)
```

Sign in at `localhost:5174/app/sign-in` (`AGENTS.md` § "There is no seeded
login" makes the account) and the tab lands in `/library`; reload it after an
edit. The page runs through the Worker's own route and policy, as a deploy
does (`apps/web/src/worker/library/library-page.ts`). What the shell holds (the
replica on disk, the Keychain, the file cache, the updater) a tab does not: it
keeps its replica in memory, its session in a cookie, and Settings' Updates row
says why it offers none. `underShell()` in `src/shell/shell-commands.ts` says
where the page runs.

## Tests

`pnpm --filter @repo/workspace test` runs the page's own suites under jsdom,
compiled by the React Compiler as the bundle is, and fails any test that logs a
`console.error` (`src/app/test-support/console-error-gate.ts`). The shell's
commands answer through Tauri's own IPC mock
(`src/shell/test-support/mock-shell.ts`). The page against a real Worker is the
e2e's: `browser-smoke`, `library-browser`, `sync-conflict-browser` and the other
`*-browser` scenarios sign in to the built Worker and drive the tab
(`tools/e2e/src/harness/library-tab.ts`).
