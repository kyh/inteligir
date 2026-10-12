# Inteligir

> The workspace for knowledge work.

Notes with an agent that edits them beside you. Your notes are plain markdown
files in a folder on your Mac. Ask Claude or ChatGPT to draft, tidy, link or
summarize, and it edits those notes directly; every reply that changed a note
can be undone, and every earlier version of a note is in its History.

## Get it

**[Download for Mac (Apple silicon)](https://inteligir.com)**

What you need:

- A Mac with Apple silicon.
- To use the agent, a paid Claude plan or any ChatGPT plan. The app signs in to
  it for you and brings everything the agent needs; without a plan it is a notes
  app.
- Nothing else to install or set up.

An account is optional and needs an invite: it keeps your notes in step across
your Macs and your iPhone, and lets your phone ask your Mac's agent. The iPhone
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
Settings › About. Its first launch asks where your notes live, a new vault or
a folder you already have, before it starts anything.

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

The agents ship inside the app: sign in with Claude or ChatGPT in
Settings › Agent; a Mac already signed in to Claude Code or Codex stays signed
in. Signed in to neither, the app is a notes editor and says so.

From a checkout instead:

```bash
pnpm install
pnpm dev              # the desktop shell over a server on a per-checkout port
```

### Layout

[`AGENTS.md`](./AGENTS.md) § Map has one line per workspace, and each
workspace's README its own layout.

Boundaries are enforced, not documented: `tools/repo-guards` derives the
dependency DAG from the tree and fails on an undeclared edge, a cycle or an
import the importer's manifest does not list, and `oxlint.config.ts` fails a
package acquiring a platform it may not have (`@repo/notes` runs in the
browser and on node; `@repo/domain` and `@repo/contract` touch neither node
nor react). knip fails a dependency nothing imports.

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — the premises,
the quickstart and the rules, and the index of the `CLAUDE.md` beside each
workspace's code that holds its durable decisions; `CONTEXT.md` is the domain
glossary.

### Develop

[`docs/development.md`](./docs/development.md) owns the commands, the ports,
where state lives and the gate. The one line every change runs before it is
committed:

```bash
pnpm format:fix && pnpm verify
```
