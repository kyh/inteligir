# Inteligir

> An AI-native notes app — Obsidian with an agent.

Your notes are plain markdown files in a folder you own, versioned with git.
The app runs on your machine: one local Node process serves the workspace UI,
owns the vault, indexes it, and drives a coding agent that edits those same
files. Nothing leaves the machine unless you configure a git remote or sign in
to sync threads across devices.

## Install & run

```bash
npx inteligir
```

That boots the local server, prints the URL and opens it. The vault is created
at `~/Inteligir` on first run; the database and settings live in `~/.inteligir`.
`--port`, `--data-dir`, `--vault` and `--no-open` override that; `^C` stops it
cleanly (the pending vault commit is flushed and the database closed before it
exits). See [`apps/launcher`](./apps/launcher/README.md).

The desktop app is the same product in a window that starts and stops the
server with it — [`apps/desktop`](./apps/desktop/README.md). It is built
unsigned from this repo (`pnpm package:desktop`); there is no download and no
update feed yet.

The agent speaks ACP: install the [Claude Code](https://claude.com/claude-code)
or [Codex](https://developers.openai.com/codex/cli) CLI and sign in, and
actions work. Without one the app is a notes editor and says so in Settings.

From a checkout instead:

```bash
pnpm install
pnpm dev              # the local server + UI, on a per-checkout port
```

## Layout

```
apps/
  app/               @repo/app — THE PRODUCT: one Node process. TanStack Start
                     SPA served by a custom entry that owns /api/v1, the /ws
                     invalidation bus, the vault, the knowledge index and the
                     agent runtime
  cli/               @repo/cli — the `inteligir` CLI over the same typed
                     contract; how agents drive the product from bash
  launcher/          inteligir — the published npx package
  desktop/           @repo/desktop — Electron shell supervising the server
  web/               @repo/web — ONE Cloudflare Worker: the marketing site,
                     Better Auth on D1, device pairing, the thread-sync
                     Durable Object and the capture inbox
packages/
  notes/             @repo/notes — pure platform-neutral domain: markdown
                     pipeline, knowledge engine (links, tags, tasks, search)
  editor/            @repo/editor — the Plate.js WYSIWYG over the fixpoint
                     serializer: kits/nodes for every dialect construct,
                     wiki chips, formula pills, comments, tag chips
  ui/                @repo/ui — vendored shadcn components
  domain/            @repo/domain — the thread grammar and lifecycle, zod-only
  server-contract/   @repo/server-contract — THE route table + ws schemas
  cloud-contract/    @repo/cloud-contract — the sync/pairing wire, zod-only
  typed-routes/      @repo/typed-routes — the contract-first route machinery
  db/                @repo/db — drizzle + better-sqlite3, migrations, notifier
  thread-view/       @repo/thread-view — isomorphic timeline projection
  agent-runtime/     @repo/agent-runtime — the codex app-server adapter
tools/
  repo-guards/       structural invariant tests over the repo itself
e2e/                 scenario harness driving a real instance
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
pnpm dev              # the product — local server + UI
pnpm dev:site         # the marketing + auth Worker (localhost:5174)
pnpm cli              # the CLI against a running instance
pnpm e2e              # scenario suite against real instances
pnpm verify           # typecheck, lint, knip, format, test, build — CI's order
pnpm package:app      # build the npx package
pnpm smoke:package    # pack it, install it, boot it, kill it
pnpm package:desktop  # build the unsigned desktop app
```

## Quality gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`format:fix` runs FIRST and never after the gates.
