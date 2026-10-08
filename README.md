# Inteligir

> The workspace for knowledge work.

Notes with an agent that edits them beside you. Your notes are plain markdown
files in a folder on your Mac. Ask Claude or ChatGPT to draft, tidy, link or
summarize, and it edits those notes directly.

## Get it

**[Download for Mac (Apple silicon)](https://inteligir.com)**

What you need:

- A Mac with Apple silicon.
- To use the agent, a paid Claude plan or any ChatGPT plan. The app brings
  everything the agent needs.
- Nothing else to install or set up.

An account is optional and needs an invite: it keeps your notes in step across
your Macs, carries your conversations with the agent to your iPhone, and lets
your phone ask your Mac's agent. The iPhone
app comes by TestFlight invite.

What leaves your Mac, and when: [docs/privacy.md](./docs/privacy.md).

## For developers

The app runs on your machine: one local Node process owns the vault (a git
repo), indexes it, serves the API, and drives the agent — Claude or Codex over
ACP — that edits those same files. Nothing reaches this project's cloud unless
you sign in; the desktop app checks GitHub for updates and the agent talks to
its own provider.

### Install & run

The desktop app is the product: one window on that local server, which it
starts and stops with itself — [`apps/desktop`](./apps/desktop/README.md). The
signed, notarized macOS build is on the latest GitHub release (the site's
Download button reads it), and an installed app offers each new release from
Settings › About.

Without installing the app:

```bash
npx inteligir serve --open
```

Same server, same workspace, in a browser tab instead of a window. The vault is
created at `~/Inteligir` the first time it serves; the database and settings live in
`~/.inteligir`. `--port`, `--data-dir` and `--vault` override that; `^C` stops
it cleanly (the pending vault commit is flushed and the database closed before
it exits). Every other verb of that same binary but `vault open`, which picks
the vault the next server opens, is a client against a running server — see
[`apps/cli`](./apps/cli/README.md).

The agents ship inside the app and use the vendor's own sign-in: a Mac already
signed in to Claude Code or Codex is signed in here too.

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
apps/web                @repo/web — ONE Cloudflare Worker: site, auth, device login, thread sync, captures, dispatch, hosted vault
apps/mobile             @repo/mobile — the iPhone app: the synced threads, and asking a Mac's agent
packages/domain         @repo/domain — zod-only leaf vocabulary
packages/contract       @repo/contract — ONE contract, TWO entries: /local and /cloud
packages/db             @repo/db — drizzle + better-sqlite3, migrations, notifier
packages/notes          @repo/notes — the pure, platform-neutral domain
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

### Develop

[`docs/development.md`](./docs/development.md) owns the commands, the ports,
where state lives and the gate. The one line every change runs before it is
committed:

```bash
pnpm format:fix && pnpm verify
```
