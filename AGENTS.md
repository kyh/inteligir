# AGENTS.md

**inteligir** is an AI-native notes app — Obsidian with an agent. The product is
a **Cloudflare Worker** (`apps/web`): the marketing site, Better Auth on D1, and
`/app` — the workspace UI over a `UserHost` Durable Object per account that
holds the vault, the knowledge index, the agent and the background work. An
Electron shell and an Expo app wrap it. This is the tool-agnostic guide for
coding agents — it's meant to be **run**, not just read. `CLAUDE.md` holds the
architecture and the durable decisions; `apps/web/README.md` the product's own
protocol and dev recipe. Both point back here.

**Every surface except mobile is headlessly agent-verifiable.** There is no
excuse for leaving a UI change "unverified".

## Quickstart

```sh
pnpm install
pnpm dev:web        # → the real Worker on miniflare, http://localhost:5174
```

That's the whole setup. `pnpm dev:web` runs the product: the site, the auth API,
the Durable Object, the vault, the index and the agent path — all in-process, no
deploy, no cloud account. (Driving it at runtime also wants the `agent-browser`
binary — one `npm i -g`, see below.)

The shell around it, when you're changing the shell:

```sh
INTELIGIR_APP_URL=http://localhost:5174 pnpm dev:desktop   # Electron, CDP :9222
```

There is no backend-free UI harness. `packages/workspace/src/dev/fixture-bridge.ts`
is an in-memory Bridge that the workspace's own tests drive; nothing serves it as
an app. To see the UI, run the Worker.

## Fresh clone / remote session

`pnpm install` is the only provisioning step — there is no bootstrap script and
nothing else to stand up. (`.codex/environments/environment.toml` runs `pnpm i`
for cloud runners.) Requirements: **Node ≥ 24** and **pnpm 10**
(`corepack enable`). The Worker and its tests run anywhere; only the Electron
shell wants macOS to package.

One footgun that bites fresh checkouts:

```sh
# `pnpm dev:desktop` dies with `Error: Electron uninstall` after a fresh
# checkout — Electron is unpacked but not downloaded:
node apps/desktop/node_modules/electron/install.js
```

## There is no seeded login, and sign-up is invite-only

This repo ships no seed script and no test account. To get one locally:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET to anything
pnpm dev:web                                       # vite dev on :5174

# The local D1 file is materialized lazily, on the first request that touches
# the binding — `dev` alone does not create it. So hit one, THEN push:
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/web db:push:local

# Sign-up is invite-gated and there is no self-serve issuance. Mint one:
pnpm --filter @repo/web exec wrangler d1 execute inteligir-auth --local \
  --command "INSERT INTO invite_code (code) VALUES ('DEV-INVITE-001')"
```

Then open `http://localhost:5174/app`, which redirects to sign-in; `/app/sign-up`
takes the invite code. Signing up returns 200 with a `set-auth-token` header —
that bearer is what a NON-browser client carries. A browser carries the session
cookie instead, and the Bridge socket authenticates with neither: it spends a
single-use ticket minted at `POST /v1/host/ticket`.

Auth is rate-limited to 10 requests/60s per IP; a script that creates several
users should set `RATE_LIMIT_DISABLED=true` in `.dev.vars` rather than weaken
the limiter.

> **Never run `db:push` or `db:studio`.** Both load `drizzle.config.ts`
> (`driver: "d1-http"`) with the root `.env.production.local` creds and hit
> the PRODUCTION D1 — `db:studio` is a read/write UI over that same database,
> not a local inspector. The only local command is `db:push:local`.

## Verify a change end-to-end

Static gate — mirrors CI exactly (typecheck · lint · knip · format · test ·
build):

```sh
pnpm format:fix && pnpm verify
```

`format:fix` runs **FIRST and never after the gates**: a post-gate format run
rewrites the byte-pinned round-trip fixtures after the tests that guard them
have already passed, so the gate reads green and the commit ships red.
`verify` is check-only for exactly that reason.

Runtime — type-checks passing is not feature-correct. Drive the running app
with [agent-browser](https://github.com/vercel-labs/agent-browser):

```sh
npm i -g agent-browser && agent-browser install   # once, if missing
pnpm dev:web
agent-browser open http://localhost:5174/app
agent-browser snapshot                      # accessibility tree with @eN refs
agent-browser click @e1
agent-browser get text                      # assert what changed
agent-browser screenshot /tmp/after.png
```

For the shell, `pnpm dev:desktop` then `agent-browser connect 9222` attaches to
its window over CDP.

Two things worth knowing before you reach for the UI:

- **Drive the Bridge directly.** From `agent-browser eval` on a signed-in `/app`
  page you can open a second host socket and call ANY Bridge method
  (`readVaultDoc`, `writeVaultDoc`, `createDelegation`, …). The credential is a
  ticket the page mints same-origin against its own session cookie — there is no
  userId in the URL and no session token in the page. Exact snippet in
  `docs/e2e-driving.md`.
- **The agent runs headlessly.** `AGENT_RUNTIME=scripted` swaps the Cloudflare
  Sandbox for an in-memory container while keeping the production runner, tool
  executor, transcript, confirmation broker and vault write-back — which is how
  the whole agent suite runs with no provider account and no image.

## Platform matrix

| Surface       | Dev command                      | Where     | Agent-verifiable at runtime?                                                    |
| ------------- | -------------------------------- | --------- | ------------------------------------------------------------------------------- |
| Web (product) | `pnpm dev:web`                   | :5174     | **Yes** — `agent-browser open`; API by curl; `-F @repo/web test` runs miniflare |
| Desktop shell | `pnpm dev:desktop`               | CDP :9222 | **Yes** — `agent-browser connect 9222`                                          |
| Mobile (Expo) | `pnpm --filter @repo/mobile dev` | simulator | **No** — verify with `typecheck` + `test`                                       |

5174 is PINNED (`strictPort`), so a stale process holding it fails the start
rather than moving the app somewhere the docs don't name. It matters more than
the number: the ticket mint's Origin allowlist is exact, so a silent bump to
5175 renders a workspace that cannot reach its own host.

## Rules that matter

- **`pnpm format:fix` before the gates, commit after.** Never the other way.
- **Never hand-edit or format `packages/editor/src/__tests__/fixtures/`** —
  those bytes _are_ the test contract (trailing spaces, indentation, line
  endings). Generate them through the `roundTrip` pipeline itself.
- **No `any`, no non-null `!`, no `as` casts** (lint-enforced). Kebab-case
  filenames. Make illegal states unrepresentable.
- **Nothing under `packages/` may import `node:*` or `electron`.** Every one of
  them is bundled into a browser; `notes` and `bridge` also into workerd and
  React Native. Lint enforces it for those two and `tools/repo-guards` enforces
  it for the rest, over shipped source only — their tests walk the filesystem on
  purpose.
- **A capability this host does not have has no Bridge channel.** A handler that
  answers only by refusing typechecks, satisfies the completeness guard AND
  `no-dead-channels`, and fails at runtime. Adding a channel is the LAST step of
  building a capability; retiring one deletes it.
- **`pnpm knip` is a CI gate.** A new file must be reachable from a knip `entry`
  glob in `knip.json` or it reads as unused and CI goes red. A tooling dep may
  pass for a non-obvious reason — `@libsql/client` survives because it is an
  optional peer of the used `drizzle-orm`, not because a config plugin found it
  (knip's drizzle plugin only matches `drizzle.config.{ts,js,json}`, never
  `drizzle.config.local.ts`, and resolves only the `schema` field).
  `ignoreDependencies` is the escape hatch for the ones it genuinely can't see,
  not a blanket rule. Run it rather than guess.
- Plan files and ADR docs are deleted on purpose — `CLAUDE.md` § Decisions plus
  GitHub Issues are the record. Don't add `plans/` or `*_GAPS.md`.

## Map

```
apps/web            THE PRODUCT — one CF Worker: marketing site,
                    Better Auth (D1), and /app over a UserHost
                    Durable Object per account                     @repo/web
apps/web/container  The agent image: pi in a per-user Cloudflare
                    Sandbox, driven by that UserHost     @repo/agent-container
apps/desktop        Electron SHELL — a window on the hosted app    @repo/desktop
apps/mobile         Expo — a signed-in shell                       @repo/mobile
packages/notes      Pure domain — knowledge + markdown             @repo/notes
packages/bridge     Iso wire contract — IPC registry, ws, grants   @repo/bridge
packages/ui         Shared components                              @repo/ui
packages/editor     The note editor — Plate kits, round-trip       @repo/editor
packages/workspace  The product UI + the fixture Bridge            @repo/workspace
tools/repo-guards   Derived fitness tests over the repo itself
```

- `CLAUDE.md` — architecture, the dep DAG, and § Decisions.
- `apps/web/README.md` — the Worker's routes and protocol, the local loop, the
  owner-only deploy.
- `docs/development.md` — the run modes, per-package test commands, the change
  checklists.
- `docs/e2e-driving.md` — driving the Bridge and the agent headlessly.
- `docs/privacy.md` — where notes actually live, and what `private: true` is not.
