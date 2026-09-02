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

```
apps/
  desktop/           @repo/desktop — THE SHIPPED PRODUCT: the window (main,
                     the inteligir:// protocol, the forked server) and the SPA
                     inside it
  cli/               inteligir — THE PUBLISHED BINARY: `serve` is the whole
                     local server (vault, index, agent, API); every other verb
                     is a client of one, and how agents drive it from bash
  web/               @repo/web — ONE Cloudflare Worker: the marketing site,
                     Better Auth on D1, device pairing, the thread-sync
                     Durable Object and the capture inbox
  mobile/            @repo/mobile — the Expo client: synced threads, quick
                     capture and a read-only notes surface over the hosted
                     vault, all over the cloud contract
packages/
  api/               @repo/api — ONE contract, TWO entry points: /local (the
                     renderer and the CLI → the local server) and /cloud (the
                     local server and mobile → the Worker)
  notes/             @repo/notes — pure platform-neutral domain: markdown
                     pipeline, knowledge engine (links, tags, tasks, search)
  editor/            @repo/editor — the Plate.js WYSIWYG over the fixpoint
                     serializer: kits/nodes for every dialect construct,
                     wiki chips, formula pills, comments, tag chips
  ui/                @repo/ui — the shared component vocabulary on Base UI;
                     vendored once, this repo's own code now
  domain/            @repo/domain — zod-only leaf vocabulary (view context,
                     provider events)
  db/                @repo/db — drizzle + better-sqlite3, migrations, notifier
  agent-runtime/     @repo/agent-runtime — the ACP adapter over the harnesses
  agent-skills/      @repo/agent-skills — the dialect spec, as files agents read
tools/
  repo-guards/       structural invariant tests over the repo itself
  e2e/               scenario harness driving a real instance
```

Boundaries are enforced, not documented: `tools/repo-guards` derives the
dependency DAG from the tree and fails on an undeclared edge, a cycle, a
phantom dependency, or a package acquiring a platform it may not have
(`@repo/notes` runs in the browser and on node; the zod-only leaves touch
neither node nor react).

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — quickstart and
the runnable recipes. `CLAUDE.md` (root) holds the architecture summary,
conventions, and the durable decisions; `CONTEXT.md` is the domain glossary.

## Common commands

```bash
pnpm dev              # the product — the shell over its own server
pnpm dev:web          # the marketing + auth Worker (localhost:5174)
pnpm cli              # the CLI against a running instance
pnpm cli serve        # the server alone, from source — the shell adopts it
pnpm e2e              # scenario suite against real instances
pnpm verify           # typecheck, lint, knip, format, test, build — CI's order
pnpm package:cli      # build the npm artifact
pnpm smoke:cli        # pack it, install it, boot it, kill it
pnpm package:desktop  # build the unsigned desktop app
pnpm smoke:desktop    # package it, boot its server, drive it, SIGTERM
```

## Quality gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`format:fix` runs FIRST and never after the gates.
