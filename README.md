# Inteligir

> An open-source inbox for the coding agents you already run.

Inteligir is being rebuilt. It used to be a notes app with an agent; that app
is gone, and in its place grows an open-source rebuild of One: a Mac app, an
iPhone remote and a Linux connector that watch the coding agents you already
run in your own terminals (Claude Code and Codex first), show at a glance
which one needs you, and let you answer, message, start and stop them, with
tmux as the control layer.

This tree is the skeleton the rebuild starts from: the local server and its
thread log, the desktop window, accounts, and the cloud relay that carries
threads and requests between your devices. None of the watching exists yet.

What leaves your Mac, and when: [docs/privacy.md](./docs/privacy.md).

## For developers

The app runs on your machine: one local Node process owns the thread log and
serves the API, and every surface (the window, the CLI) is a client of it. No
model runs inside the app and none is called through this project's cloud:
the agents are the ones you already run, on your own plans. Nothing reaches
this project's cloud unless you sign in; the desktop app checks GitHub for
updates.

### Install & run

The desktop app is the product: one window on that local server, which it
starts and stops with itself — [`apps/desktop`](./apps/desktop/README.md).

Without installing the app:

```bash
npx inteligir serve --open
```

Same server, same workspace, in a browser tab instead of a window. The
database and settings live in `~/.inteligir`; `--port` and `--data-dir`
override that, and `^C` stops it cleanly. Every other verb of that same binary
is a client against a running server — see [`apps/cli`](./apps/cli/README.md).

From a checkout instead:

```bash
pnpm install
pnpm dev              # the desktop shell over a server on a per-checkout port
```

### Layout

One line per workspace; [`CLAUDE.md`](./CLAUDE.md) § Workspace Structure is
the owned description of each.

```
apps/desktop            @repo/desktop — THE SHIPPED PRODUCT: the window and the SPA in it
apps/cli                inteligir — THE PUBLISHED BINARY: `serve` is the server, every other verb a client
apps/web                @repo/web — ONE Cloudflare Worker: site, auth, device login, thread sync, dispatch
apps/mobile             @repo/mobile — the iPhone app: the synced threads, and asking a Mac's agent
packages/domain         @repo/domain — zod-only leaf vocabulary
packages/contract       @repo/contract — ONE contract, TWO entries: /local and /cloud
packages/db             @repo/db — drizzle + better-sqlite3, migrations, notifier
packages/ui             @repo/ui — the shared component vocabulary on Base UI
tools/repo-guards       @repo/repo-guards — fitness tests over the repo itself
tools/e2e               @repo/e2e — the scenario suite `pnpm e2e` runs
```

Boundaries are enforced, not documented: `tools/repo-guards` derives the
dependency DAG from the tree and fails on an undeclared edge, a cycle, a
phantom dependency, or a package acquiring a platform it may not have
(the contract loads in every client, and the zod-only leaves touch neither
node nor react).

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — quickstart and
the runnable recipes. `CLAUDE.md` (root) holds the architecture summary,
conventions, and the durable decisions; `CONTEXT.md` is the domain glossary.

### Develop

[`docs/development.md`](./docs/development.md) owns the commands, the ports,
where state lives and the gate. The one line every change runs before it is
committed:

```bash
pnpm format:fix && pnpm verify
```
