# AGENTS.md

**inteligir** is an AI-native notes app — Obsidian with an agent, local-first.
There are TWO programs. `apps/cli` is the `inteligir` binary: `serve` runs the
whole local server (a git-versioned markdown vault, its index, the agent
runtime and one oRPC API over SQLite), and every other verb is a client of a
running one — which is how an agent drives the product from bash.
`apps/desktop` is THE SHIPPED PRODUCT: one window on that server, forking it as
a child, with the SPA as its renderer. `apps/web` is the one hosted piece — a
Cloudflare Worker carrying the marketing site, Better Auth on D1, device
login, cross-device thread sync, the capture inbox and the hosted vault git
remote. This is the tool-agnostic guide for
coding agents; `CLAUDE.md` holds the architecture and the durable decisions,
GitHub issues #542 and #611 the decision record, `CONTEXT.md` the domain
glossary, `apps/web/README.md` the Worker's own routes and deploy.

## Quickstart

```sh
pnpm install
pnpm dev             # → THE PRODUCT: the shell over its own server, e.g.
                     #   inteligir 0.4.0 (dev) listening on http://127.0.0.1:26723
pnpm cli serve       # → the server ALONE, from source, no window. A shell
                     #   started afterwards ADOPTS it, so this is the loop for
                     #   iterating on server code.
```

That's the whole product setup — no bootstrap script, no Docker, no cloud
account, no login. The port and the data dir are derived per CHECKOUT (hash of
the checkout root, walked up to from wherever the command started), so parallel
worktrees never collide and every command in one checkout names one instance;
`INTELIGIR_PORT` and `INTELIGIR_DATA_DIR` override. SQLite lives at
`<data-dir>/inteligir.db` (dev default: `~/.inteligir-dev/<hash>/`).

Requirements: **Node 24** and **pnpm 12** (`corepack enable` reads the
root `packageManager`).
(`.codex/environments/environment.toml` runs `pnpm i` for cloud runners.)

The agent RUNTIME is selected by `INTELIGIR_AGENT` (`auto` · `scripted` ·
`off`; default `auto` — the ACP runtime when Claude Code or the Codex CLI is on
PATH, else an unavailable driver whose reason `system.status` states under
`agent`). WHICH harness runs is a thread's own `providerId`, never this
variable.
**`INTELIGIR_AGENT=scripted` is the login-free e2e mode**: an in-process
deterministic driver over the REAL ingest/timeline/vault/commit paths — send an
action message, watch the turn stream, find the note in the vault with an
agent-attributed commit. `INTELIGIR_AGENT_MODEL` passes a model through.

**The `inteligir` CLI drives a running instance from the shell** — often
faster than the browser for vault/search/action checks:

```sh
pnpm cli status            # reads this checkout's <dataDir>/server.json
pnpm cli guide             # the agent manual the app serves (system.guide)
```

Every leaf takes `--json`. `INTELIGIR_DATA_DIR` names WHICH instance — the port
and the bearer are both read out of the `server.json` there, so the address and
the credential can never disagree. Agent shells get it injected, plus
`INTELIGIR_THREAD_ID` for their own thread; there is deliberately no way to
point the CLI at a bare URL.

The marketing/auth Worker is separate:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET
pnpm dev:web        # → the real Worker on miniflare, http://localhost:5174
```

`.dev.vars` must exist first: `BETTER_AUTH_SECRET` is what makes `/api/auth/*`
answer at all. Any value works locally.

## There is no seeded login, and sign-up is invite-only

This repo ships no seed script and no test account. To get one locally:

```sh
pnpm dev:web                                       # vite dev on :5174

# The local D1 file is materialized lazily, on the first request that touches
# the binding — `dev` alone does not create it. So hit one, THEN push:
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/web db:push:local

# Sign-up is invite-gated and there is no self-serve issuance. Mint one.
# `code` is the primary key, so re-running this literal command after a code has
# been minted fails on the constraint — pick a fresh string each time:
pnpm --filter @repo/web exec wrangler d1 execute inteligir-auth --local \
  --command "INSERT INTO invite_code (code) VALUES ('DEV-INVITE-001')"
```

Then `/app/sign-up` takes the invite code. Signing up returns 200 with a
`set-auth-token` header — that bearer is what a NON-browser client carries; a
browser carries the session cookie instead.

Auth is rate-limited to 10 requests/60s per IP; a script that creates several
users should set `RATE_LIMIT_DISABLED=true` in `.dev.vars` rather than weaken
the limiter.

> **Never run `db:push` or `db:studio`.** Both load `drizzle.config.ts`
> (`driver: "d1-http"`) with the root `.env.production.local` creds and hit
> the PRODUCTION D1 — `db:studio` is a read/write UI over that same database,
> not a local inspector. The only local command is `db:push:local`.

## Verify a change

```sh
pnpm format:fix && pnpm verify
```

`format:fix` runs **FIRST and never after the gates**; `verify` is check-only
for exactly that reason. `docs/development.md` owns the full command list,
the ports, where state lives, and what CI runs on top of `verify`.

Runtime — drive the running site with
[agent-browser](https://github.com/vercel-labs/agent-browser):

```sh
npm i -g agent-browser && agent-browser install   # once, if missing
pnpm dev:web
agent-browser open http://localhost:5174/
```

5174 is PINNED (`strictPort`), so a stale process holding it fails the start
rather than moving the app somewhere the docs don't name.

## Rules that matter

- **`pnpm format:fix` before the gates, commit after.** Never the other way.
- **No `any`, no non-null `!`, no `as` casts** (lint-enforced). Kebab-case
  filenames. Make illegal states unrepresentable.
- **`@repo/notes` is pure and platform-neutral** — no node/react/ui imports
  (lint-enforced); callers inject platform capabilities (the SQL driver, the
  clock).
- **`pnpm knip` is a CI gate.** A new file must be reachable from a knip
  `entry` glob in `knip.json` or it reads as unused and CI goes red.
  `ignoreDependencies` is the escape hatch for what knip genuinely can't see,
  not a blanket rule.
- Plan files and ADR docs are deleted on purpose — `CLAUDE.md` § Decisions plus
  GitHub Issues are the record. Don't add `plans/` or `*_GAPS.md`.

## Map

One line per workspace; `CLAUDE.md` § Workspace Structure is the owned
description of each.

```
apps/desktop            @repo/desktop — THE SHIPPED PRODUCT: the window and the SPA in it
apps/cli                inteligir — THE PUBLISHED BINARY: `serve` is the server, every other verb a client
apps/web                @repo/web — ONE Cloudflare Worker: site, auth, device login, thread sync, captures, hosted vault
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

- `CLAUDE.md` — architecture and § Decisions.
- `CONTEXT.md` — the domain glossary.
- `apps/web/README.md` — the Worker's routes, auth, dev loop, deploy.
- `docs/development.md` — the dev loop in one page.
- `apps/cli/README.md` — the binary's two modes and every verb.
- `apps/desktop/README.md` — the window, the protocol, the packaged app.
- `docs/privacy.md` — what leaves the machine, what never does, how it dies.
