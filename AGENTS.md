# AGENTS.md

**inteligir** is an AI-native notes app — Obsidian with an agent. The product is
an **Electron desktop app** over a local Node host; a Cloudflare Worker serves
auth and the server-side vault, an Expo app is a remote control for a paired
desktop, and a TanStack Start site is marketing. This is the tool-agnostic guide for coding agents —
it's meant to be **run**, not just read. `CLAUDE.md` holds the architecture and
the durable decisions; `docs/development.md` the full dev loop. Both point back
here.

Unusually for a desktop product, **every surface except mobile is headlessly
agent-verifiable** — the dev script already exposes Electron's remote-debugging
port. There is no excuse for leaving a UI change "unverified".

## Quickstart (headless)

```sh
pnpm install
pnpm --filter @repo/desktop dev:harness    # → http://localhost:5173
```

That's the whole setup for writing code. (Driving the app at runtime also wants
the `agent-browser` binary — one `npm i -g`, see below.) The harness is a plain
browser page running the **real
renderer UI** over an in-memory fixture Bridge (`apps/desktop/dev/`) with a
sample vault and the real knowledge engine. No Electron, no backend, no auth,
no vault on disk. Use it for all UI and editor work — it is the fastest loop by
a wide margin.

The real product:

```sh
pnpm dev:desktop     # Electron + the @repo/server host, HMR, CDP :9222, executor :47888
```

## Fresh clone / remote session

`pnpm install` is the only provisioning step for the repo itself — there is no
bootstrap script and nothing else to stand up. (Runtime verification also needs
the global `agent-browser` binary — see § Verify a change end-to-end.) (`.codex/environments/environment.toml` runs `pnpm i`
for cloud runners.) Requirements: **Node ≥ 24**, **pnpm 10** (`corepack
enable`), and **macOS** for the Electron app + voice; the browser harness runs
anywhere.

Two footguns that only bite fresh checkouts:

```sh
# `pnpm dev:desktop` dies with `Error: Electron uninstall` after a fresh
# checkout or `git worktree` — Electron is unpacked but not downloaded:
node apps/desktop/node_modules/electron/install.js

# Stale processes hold 9222 / 47888 and the next launch can't bind them:
pkill -f "turbo watch dev"; pkill -f "electron-vite"; pkill -f "Electron.app/Contents/MacOS/Electron"
```

**No login is needed for the product.** The desktop app is guest by default, so
chat, the editor, delegation, knowledge and the vault all work with zero
provisioning.

## There is no seeded login — provision one only for the account surface

This repo ships **no seed script and no test account**. Notes live in the
user's local vault, never in a server database, so there is nothing to seed
beyond a user row. If you actually need an account (Settings → Account), stand
up the local Worker — four commands:

```sh
cp apps/web/.dev.vars.example apps/web/.dev.vars   # set BETTER_AUTH_SECRET to anything
pnpm dev:web                                       # vite dev → http://localhost:5174

curl -s -o /dev/null localhost:5174/api/auth/get-session   # materializes the local D1 file
pnpm --filter @repo/web db:push:local                      # apply the schema to it

# Better Auth refuses a state-changing request with no Origin (MISSING_OR_NULL_ORIGIN).
curl -s -X POST localhost:5174/api/auth/sign-up/email \
  -H 'content-type: application/json' -H 'origin: http://localhost:5174' \
  -d '{"email":"dev@inteligir.local","password":"password","name":"Dev"}'
```

The sign-up returns 200 with a `set-auth-token` header — that bearer is the
session credential every client carries. To drive it through a UI instead, put
`http://localhost:5174` in the desktop's Settings → Account server URL.

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
pnpm --filter @repo/desktop dev:harness
agent-browser open http://localhost:5173
agent-browser snapshot                      # accessibility tree with @eN refs
agent-browser click @e1
agent-browser get text                      # assert what changed
agent-browser screenshot /tmp/after.png
```

For the real product, `pnpm dev:desktop` then `agent-browser connect 9222`
attaches to the Electron renderer over CDP.

Two things worth knowing before you reach for the UI:

- **Drive the Bridge directly.** The renderer holds `{ url, token }` at
  `window.bridgeBootstrap`; from `agent-browser eval` you can open that
  WebSocket and call ANY Bridge method (`readVaultDoc`, `writeVaultDoc`,
  `createDelegation`, …). Exact snippet in `docs/e2e-driving.md`.
- **Agent, delegation and connector flows are login-free.** Two fail-closed
  dev flags (`INTELIGIR_FAUX_AGENT=1`, `INTELIGIR_EMULATE_CONNECTORS=1` in
  `apps/desktop/.env`) script the pi provider and point Google OAuth at a local
  `emulate` stub. See `.claude/skills/e2e-drive` and `docs/e2e-driving.md` —
  including the mandatory teardown.

## Platform matrix

| Surface           | Dev command                               | Where     | Agent-verifiable at runtime?                                                                      |
| ----------------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| Desktop harness   | `pnpm --filter @repo/desktop dev:harness` | :5173     | **Yes** — `agent-browser open`                                                                    |
| Desktop (product) | `pnpm dev:desktop`                        | CDP :9222 | **Yes** — `agent-browser connect 9222`                                                            |
| Web (site + API)  | `pnpm dev:web`                            | :5174     | **Yes** — `agent-browser open`; API by curl. Also `-F @repo/web test` (real in-process miniflare) |
| Mobile (Expo)     | `pnpm --filter @repo/mobile dev`          | simulator | **No** — verify with `typecheck` + `test`                                                         |

Ports auto-increment if taken, so read the dev server's own output before
assuming a URL.

## Rules that matter

- **`pnpm format:fix` before the gates, commit after.** Never the other way.
- **Never hand-edit or format `apps/desktop/src/renderer/__tests__/fixtures/`** —
  those bytes _are_ the test contract (trailing spaces, indentation, line
  endings). Generate them through the `roundTrip` pipeline itself.
- **No `any`, no non-null `!`, no `as` casts** (lint-enforced). Kebab-case
  filenames. Make illegal states unrepresentable.
- **The renderer never imports electron/node/`@repo/server`** — that's a package
  fact (no dep edge), not a lint opinion. `@repo/notes` stays platform-neutral.
- **`pnpm knip` is a CI gate.** A new file must be reachable from a knip `entry`
  glob in `knip.json` or it reads as unused and CI goes red. A tooling dep may
  pass for a non-obvious reason — `@libsql/client` survives because it is an
  optional peer of the used `drizzle-orm`, not because a config plugin found it
  (knip's drizzle plugin only matches `drizzle.config.{ts,js,json}`, never
  `drizzle.config.local.ts`, and resolves only the `schema` field).
  `ignoreDependencies` is the escape hatch for the ones it genuinely can't see,
  not a blanket rule. Run it rather than guess.
- Plan files and ADR docs are deleted on purpose — `CLAUDE.md` § Decisions plus
  the PR history is the record. Don't add `plans/` or `*_GAPS.md`.

## Map

```
apps/desktop    Electron shell + the product UI (renderer)      @repo/desktop
apps/mobile     Expo companion — remote control, no agent       @repo/mobile
apps/web        ONE CF Worker — marketing site + Better Auth (D1)
                + the UserHost DO holding the vault, one origin  @repo/web
apps/web/container  The agent image: pi in a per-user Cloudflare
                Sandbox, driven by that UserHost       @repo/agent-container
packages/notes  Pure domain — knowledge + markdown              @repo/notes
packages/bridge Iso wire contract — IPC registry, ws, schemas   @repo/bridge
packages/server Node host — the composition root                @repo/server
packages/{agent,vault,storage,voice,connectors,sync,installer,ui}
```

- `CLAUDE.md` — architecture, the dep DAG, and § Decisions.
- `docs/development.md` — the two run modes, ports + `~/.inteligir` shared
  state, change checklists, per-package test commands.
- `docs/e2e-driving.md` — login-free chat / delegation / connector recipes.
- `docs/privacy.md` — the `private: true` guarantee and its holes.
- `apps/web/README.md` — the Worker's protocol, local loop, and owner-only
  deploy.
