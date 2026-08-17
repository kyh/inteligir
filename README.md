# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo, mid-rewrite: the v3 architecture is
[issue #542](https://github.com/kyh/inteligir/issues/542), and features land
with their own issues from that index. What runs today is the marketing site
and the account surface, plus the carried domain packages.

## Install & run

Everything runs on your own machine. Your notes are plain markdown files in a
folder you own, versioned with git.

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

From a checkout instead:

```bash
pnpm install
pnpm dev              # the local server + UI, on a per-checkout port
```

## Layout

```
apps/
  web/               @repo/web — ONE Cloudflare Worker: the TanStack Start
                     marketing site, the auth pages, Better Auth on D1
packages/
  notes/             Pure platform-neutral domain — knowledge + markdown (@repo/notes)
  ui/                Shared UI components — vendored shadcn (@repo/ui)
```

Workspace `README.md`s:

| Workspace        | README                                                           |
| ---------------- | ---------------------------------------------------------------- |
| `apps/web`       | [inteligir.com — the site + auth Worker](./apps/web/README.md)   |
| `packages/notes` | [pure domain — knowledge + markdown](./packages/notes/README.md) |
| `packages/ui`    | [shared design system](./packages/ui/README.md)                  |

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — quickstart and
the runnable recipes. `CLAUDE.md` (root) holds the architecture summary,
conventions, and the durable decisions; `CONTEXT.md` is the domain glossary.

## Common commands

```bash
pnpm dev:web          # The site + auth Worker — localhost:5174
pnpm dev              # All workspaces
pnpm build
pnpm typecheck
pnpm lint             # oxlint
pnpm format           # oxfmt --check
pnpm test
pnpm knip             # Dead exports / unused deps
pnpm verify           # All of the above, in CI's order
```

## Quality gates

Before committing:

```bash
pnpm format:fix && pnpm verify
```

`format:fix` runs FIRST and never after the gates.
