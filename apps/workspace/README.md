# @repo/workspace — the page

The SPA every vault's server answers, which the desktop window loads from that
server's own origin and `inteligir serve --open` opens in a browser tab, and the
first-run page the desktop shell carries before any server exists. It reaches
neither the shell's source nor the server's: the shell embeds the first-run
build ([`apps/desktop`](../desktop/README.md)), the CLI stages the app page as
its `dist/ui` ([`apps/cli`](../cli/README.md)), and the page talks to each over
its wire.

```
src/            index.html (the app page) and first-run.html, each its own build
                (vite.config.ts); TanStack Router file routes over @repo/contract/local
src/app/        the workspace: the note, the rail, the palette, the panel, Settings
src/first-run/  the page a launch with no vault opens: no router, no server
src/shell/      what the page says to the Tauri shell: one command per row of
                ipc-contract.ts, the states they carry, and shell-commands.ts, the
                one door that parses every answer
scripts/dev.ts  `pnpm dev:workspace`
```

## Running it

```bash
pnpm dev:workspace    # the page's Vite, and this checkout's server from source
                      # answering its files, opened in a browser tab; no Rust
pnpm dev              # the same page inside the desktop shell (tauri dev)
```

Either way the page keeps its server's origin, its sign-in and its socket,
and only its files come from Vite (`apps/cli/src/server/ui-dev-server.ts`), so
an edit reloads in place. Vite listens on 31000, pinned, since `tauri dev` waits
on it. Anything that needs the shell (the updater, the vault switch, Reveal,
printing, the diagnostics) draws nothing in a tab: `underShell()` in
`src/shell/shell-commands.ts` says where the page runs.

## Tests

`pnpm --filter @repo/workspace test` runs the page's own suites under jsdom,
compiled by the React Compiler as the bundle is, and fails any test that logs a
`console.error` (`src/app/__tests__/console-error-gate.ts`). The shell's
commands answer through Tauri's own IPC mock (`src/shell/__tests__/mock-shell.ts`).

The suites that boot a real server in-process live in the CLI, beside the
harness they use (`apps/cli/src/workspace/__tests__`), and import the modules
they drive through this package's `exports`, so the page never depends on the
server it talks to.
