# Inteligir

> An AI-native notes app — Obsidian with an agent.

Your notes are plain markdown files in a folder you own, versioned with git.
The app runs on your machine: one local Node process owns the vault, indexes
it, serves the API, and drives a coding agent that edits those same files.
Nothing leaves the machine unless you configure a git remote or sign in to sync
threads across devices.

## Install & run

The desktop app is the product: one window on that local server, which it
starts and stops with itself — [`apps/desktop`](./apps/desktop/README.md). It
is built unsigned from this repo (`pnpm package:desktop`); there is no download
and no update feed yet.

Without installing anything:

```bash
npx inteligir serve --open
```

Same server, same workspace, in a browser tab instead of a window. The vault is
created at `~/Inteligir` on first run; the database and settings live in
`~/.inteligir`. `--port`, `--data-dir` and `--vault` override that; `^C` stops
it cleanly (the pending vault commit is flushed and the database closed before
it exits). Every other verb of that same binary is a client against a running
server — see [`apps/cli`](./apps/cli/README.md).

The agent speaks ACP: install the [Claude Code](https://claude.com/claude-code)
or [Codex](https://developers.openai.com/codex/cli) CLI and sign in, and
actions work. Without one the app is a notes editor and says so in Settings.

From a checkout instead:

```bash
pnpm install
pnpm dev              # the desktop shell over a server on a per-checkout port
```

## Layout

One line per workspace; [`CLAUDE.md`](./CLAUDE.md) § Workspace Structure is
the owned description of each.

```
apps/desktop            @repo/desktop — THE SHIPPED PRODUCT: the window and the SPA in it
apps/cli                inteligir — THE PUBLISHED BINARY: `serve` is the server, every other verb a client
apps/web                @repo/web — ONE Cloudflare Worker: site, auth, pairing, thread sync, captures, hosted vault
apps/mobile             @repo/mobile — the Expo client: threads, captures, read-only notes
packages/domain         @repo/domain — zod-only leaf vocabulary
packages/api            @repo/api — ONE contract, TWO entries: /local and /cloud
packages/db             @repo/db — drizzle + better-sqlite3, migrations, notifier
packages/notes          @repo/notes — the pure, platform-neutral domain
packages/editor         @repo/editor — the Plate WYSIWYG over the fixpoint serializer
packages/agent-runtime  @repo/agent-runtime — the ACP runtime over the harnesses
packages/agent-skills   @repo/agent-skills — the dialect spec, as files agents read
packages/ui             @repo/ui — the shared component vocabulary on Base UI
tools/repo-guards       @repo/repo-guards — fitness tests over the repo itself
tools/e2e               @repo/e2e — the scenario suite `pnpm e2e` runs
```

Boundaries are enforced, not documented: `tools/repo-guards` derives the
dependency DAG from the tree and fails on an undeclared edge, a cycle, a
phantom dependency, or a package acquiring a platform it may not have
(`@repo/notes` runs in the browser and on node; the zod-only leaves touch
neither node nor react).

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — quickstart and
the runnable recipes. `CLAUDE.md` (root) holds the architecture summary,
conventions, and the durable decisions; `CONTEXT.md` is the domain glossary.

## Develop

[`docs/development.md`](./docs/development.md) owns the commands, the ports,
where state lives and the gate. The one line every change runs before it is
committed:

```bash
pnpm format:fix && pnpm verify
```
