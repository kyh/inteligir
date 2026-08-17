# AGENTS.md

**inteligir** is an AI-native notes app — Obsidian with an agent. The repo is
mid-rewrite: the v3 architecture is GitHub issue #542, and features land with
their own issues from that index. What runs today: `apps/app` — THE PRODUCT, a
local Node process (TanStack Start SPA + typed /api/v1 + ws invalidation bus
over SQLite) — and `apps/web`, one Cloudflare Worker serving the marketing
site and Better Auth on D1, plus the carried domain packages (`@repo/notes`,
`@repo/ui`). This is the tool-agnostic guide for coding agents; `CLAUDE.md`
holds the architecture and the durable decisions, `CONTEXT.md` the domain
glossary, `apps/web/README.md` the Worker's own routes and deploy.

## Quickstart

```sh
pnpm install
pnpm dev             # → THE PRODUCT (apps/app); prints its own URL, e.g.
                     #   inteligir 0.1.0 (dev) listening on http://127.0.0.1:26723
```

That's the whole product setup — no bootstrap script, no Docker, no cloud
account, no login. The port and the data dir are derived per checkout (hash of
the checkout path), so parallel worktrees never collide; `INTELIGIR_PORT` and
`INTELIGIR_DATA_DIR` override. SQLite lives at `<data-dir>/inteligir.db`
(dev default: `~/.inteligir-dev/<hash>/`).

Requirements: **Node ≥ 24** and **pnpm 10** (`corepack enable`).
(`.codex/environments/environment.toml` runs `pnpm i` for cloud runners.)

The agent provider is selected by `INTELIGIR_AGENT` (`auto` · `codex` ·
`scripted` · `off`; default `auto` — codex when the binary is on PATH, else an
unavailable driver whose reason `/api/v1/system/status` states under `agent`).
**`INTELIGIR_AGENT=scripted` is the login-free e2e mode**: an in-process
deterministic driver over the REAL ingest/timeline/vault/commit paths — send a
thread message, watch the turn stream, find the note in the vault with an
agent-attributed commit. `INTELIGIR_AGENT_MODEL` passes a model through.

**The `inteligir` CLI drives a running instance from the shell** — often
faster than the browser for vault/search/thread checks:

```sh
pnpm cli status            # discovers the per-checkout instance and probes it
pnpm cli guide             # the agent manual the app serves (GET /api/v1/guide)
```

Every leaf takes `--json`. `INTELIGIR_SERVER_URL` pins the target explicitly
(agent shells get it injected, plus `INTELIGIR_THREAD_ID` for their own
thread).

The marketing/auth Worker is separate:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET
pnpm dev:site        # → the real Worker on miniflare, http://localhost:5174
```

`.dev.vars` must exist first: `BETTER_AUTH_SECRET` is what makes `/api/auth/*`
answer at all. Any value works locally.

## There is no seeded login, and sign-up is invite-only

This repo ships no seed script and no test account. To get one locally:

```sh
pnpm dev:site                                       # vite dev on :5174

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

Static gate — mirrors CI exactly (typecheck · lint · knip · format · test ·
build):

```sh
pnpm format:fix && pnpm verify
```

`format:fix` runs **FIRST and never after the gates**; `verify` is check-only
for exactly that reason.

Runtime — drive the running site with
[agent-browser](https://github.com/vercel-labs/agent-browser):

```sh
npm i -g agent-browser && agent-browser install   # once, if missing
pnpm dev:site
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
  `@libsql/client` survives because it is an optional peer of the used
  `drizzle-orm`; `ignoreDependencies` is the escape hatch for what knip
  genuinely can't see, not a blanket rule.
- Plan files and ADR docs are deleted on purpose — `CLAUDE.md` § Decisions plus
  GitHub Issues are the record. Don't add `plans/` or `*_GAPS.md`.

## Map

```
apps/app                 THE PRODUCT: local Node server — Start SPA +
                         /api/v1 + /ws + SQLite                      @repo/app
apps/cli                 The `inteligir` CLI over the typed client   @repo/cli
apps/web                 ONE CF Worker: marketing + Better Auth (D1) @repo/web
packages/typed-routes    Contract-first Hono route machinery (bb)    @repo/typed-routes
packages/server-contract The wire contract: route table + ws proto   @repo/server-contract
packages/db              drizzle + better-sqlite3, migrations,
                         DbNotifier, ids                             @repo/db
packages/agent-runtime   bb's provider runtime, codex slice:
                         JSON-RPC/stdio + adapter (PROVENANCE.md)    @repo/agent-runtime
packages/notes           Pure domain — knowledge + markdown          @repo/notes
packages/ui              Shared components (vendored shadcn)         @repo/ui
tools/repo-guards        Fitness tests over the repo: the dep DAG,
                         ws change kinds, vendored provenance        @repo/repo-guards
```

- `CLAUDE.md` — architecture and § Decisions.
- `CONTEXT.md` — the domain glossary.
- `apps/web/README.md` — the Worker's routes, auth, dev loop, deploy.
- `docs/development.md` — the dev loop in one page.
- `docs/privacy.md` — placeholder until the v3 cloud rework (issue #554).
