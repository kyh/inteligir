# Development guide

How to run, verify, and change inteligir. Written for humans and agents alike;
`CLAUDE.md` holds the architecture summary, `apps/web/README.md` the product's
own protocol and deploy, and this holds the dev loop across the three clients.

## Prerequisites

- Node ≥ 24 (repo developed on 24.x), pnpm 10 (`corepack enable`)
- `pnpm install` at the repo root (workspace-wide)
- `cp apps/web/.dev.vars.example apps/web/.dev.vars`, then set
  `BETTER_AUTH_SECRET` to anything. Without it every `/api/auth/*` request
  fails; without the example's `HOST_ALLOWED_ORIGINS=http://localhost:5174` the
  ticket mint refuses the dev origin and `/app` cannot reach its host.
- **Docker, for `pnpm dev:web` only.** `wrangler.jsonc` declares a `containers`
  block, so the vite plugin builds the agent image at server-start time —
  before any Worker code reads `AGENT_RUNTIME`, which is why `scripted` does not
  excuse it. Without a running daemon the start exits with "The Docker CLI is
  needed to build the configured image before running dev". Every test suite
  runs without it, and so does packaging; only the Electron shell wants macOS.

## Running the product

```bash
pnpm dev:web        # vite + miniflare — the real Worker, in-process
```

One command runs the whole product: the marketing site, `/api/auth/*` over a
local D1 file, and `/app` — the workspace over a real `UserHost` Durable Object
with the real vault (SQLite manifest + local R2), the real knowledge index, and
the real agent path. Nothing is stubbed except the agent's container, which is
the in-memory one when `AGENT_RUNTIME=scripted` is set in `.dev.vars` — which
`.dev.vars.example` does. The variable is the ONLY switch: unset, you get the
real Cloudflare Sandbox, which wants the Workers Paid plan and a built image and
fails at container boot without them.

Sign-up is invite-only and there is no seeded account. `AGENTS.md` § "There is no
seeded login" has the exact commands to materialize the local D1 file, push the
schema, mint an invite and sign up against it.

There is no backend-free UI harness. `packages/workspace/src/dev/fixture-bridge.ts`
is an in-memory Bridge, but only the workspace's own tests drive it — to see the
UI, run the Worker.

### The shell

```bash
INTELIGIR_APP_URL=http://localhost:5174 pnpm dev:desktop   # electron-vite, CDP :9222
```

`apps/desktop` is a window on whatever origin `INTELIGIR_APP_URL` names,
falling back to the origin baked in at build time and then to
`https://inteligir.com` — so dropping the variable points the shell at
PRODUCTION rather than at a local Worker. It reaches the task because
`apps/desktop/turbo.json` names it in `dev`'s `passThroughEnv`; turbo runs in
strict env mode and strips anything unnamed. It owns no vault and no agent: the
window, the
`inteligir://` scheme, a tray, a summon shortcut, the navigation pin and shell
auto-update, and nothing else. Change it when you're changing THOSE; everything
else is `pnpm dev:web`.

### Mobile

```bash
pnpm --filter @repo/mobile dev     # Expo, needs a device/simulator
```

A signed-in shell: it holds a Better Auth session against the deployment
(`EXPO_PUBLIC_INTELIGIR_URL`, default production) and says plainly that the
notes, the agent and background work live in the web app. The host's server-side
half of a companion already exists — a bearer credential with no browser
`Origin` mints a ticket for the `mobile` client class, whose reach is
`REMOTE_ALLOWED_METHODS`/`_EVENTS` — but no companion surface is built on it.

## Where state lives

| What                                   | Where                                           |
| -------------------------------------- | ----------------------------------------------- |
| Site + product Worker (`pnpm dev:web`) | 5174 (pinned — `strictPort`)                    |
| Electron CDP debugging                 | 9222                                            |
| A user's vault manifest + app state    | their `UserHost` Durable Object's SQLite and KV |
| A user's file bytes                    | R2, under that user's prefix                    |
| A user's chat transcript + snapshots   | the same Durable Object (snapshot bytes in R2)  |
| Accounts, sessions, invites            | D1 (local file under `apps/web/.wrangler`)      |

**The knowledge index is a cache.** It persists into the same Durable Object's
SQLite purely to make a wake cheap; corruption or a version mismatch drops the
store's own tables and rebuilds from the manifest. Never put durable state in
it — that database also holds the manifest, whose law is the opposite. Search is
FTS5 bm25 (title/heading/body weighted 10/4/1) through that store.

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` = `typecheck && lint && knip && format && test && build`, the same
six steps CI runs. It is check-only on purpose — `format:fix` is a separate
first step, never folded in.

Rules that are easy to get backwards:

- **Format before gates, commit after gates.** A `format:fix` run after green
  gates rewrites the byte-pinned fixtures the tests just validated: the gate
  reads green and the commit ships red.
- **Never hand-edit or format round-trip fixtures**
  (`packages/editor/src/__tests__/fixtures/`): their bytes ARE the test contract
  (trailing spaces, indentation, line endings). oxfmt ignores the directory;
  editors must too. Generate fixture bytes through the pipeline itself
  (`roundTrip`) — see the fixture tests for the pattern.
- CI runs every gate independently (each step runs even if an earlier one
  fails), so a red format cannot hide test regressions behind it.

## Verifying UI changes

Type-checks passing isn't feature-correct. Drive the running app:

- **Web**: `agent-browser open http://localhost:5174/app` (the agent-browser
  skill), or raw CDP if the daemon misbehaves.
- **Shell**: `agent-browser connect 9222` attaches to its window.
- **The Bridge directly**: from a signed-in `/app` page you can open a second
  host socket and call any method — `docs/e2e-driving.md` has the snippet.
- Byte-level checks: toggle Raw mode in the editor, or read the file back over
  the Bridge — the byte-stability invariant (`roundTrip(raw) === raw` for
  canonical files) is the thing most UI regressions break.

## Making changes — the two cross-cutting recipes

Both live as skills, so the steps sit next to the code they name rather than
rotting in prose here:

- **Adding a Bridge channel** — `.claude/skills/add-bridge-channel/`. Registry
  entry, host handler, fixture stub, event emission + reconnect hydration, and
  the client-class allowlist decision.
- **Adding an editor node type** — `.claude/skills/add-editor-node/`. The
  Base + React kit pair, the `base-kit`/`editor-kit` composition, the Slate↔mdast
  rule, the MDX vocabulary gate, and the byte-pinned round-trip fixtures.

## Tests

- `pnpm --filter @repo/notes test` — the pure domain: the knowledge engine
  (link graph, search, related notes, rename), tags and tasks, markdown
  parse/vocabulary/frontmatter.
- `pnpm --filter @repo/web test` — the product, against real in-process
  miniflare (UserHost DO + R2 + D1 + Better Auth): the handler map, the vault,
  the index, the agent and its tools, background work, capture, voice, auth.
- `pnpm --filter @repo/editor test` — the editor: the round-trip matrix, the
  adversarial harness, kit parity, corpus classification, inline AI.
- `pnpm --filter @repo/workspace test` — the product UI over the fixture Bridge.
- `pnpm --filter @repo/bridge test` — the iso wire contract (parsers, schemas,
  ws protocol, the agent grant table's completeness).
- `pnpm --filter @repo/desktop test` — the shell's pure policy: the navigation
  guard, the deep-link translation, the app origin, the updater.
- `pnpm --filter @repo/repo-guards test` — the repo-level guards: the dep-DAG
  paragraph against the manifests, `packages/` shipped source free of
  node/electron, no dead Bridge channels, and the pi quarantine
  (`tools/repo-guards/README.md` says what each one pins and how to re-anchor
  it).
- `pnpm --filter @repo/mobile test` — the pure mobile modules on node.

## Releasing the desktop shell

Use the `release` skill (`.claude/skills/release/`) — bump, build, notarize,
publish to GitHub Releases (electron-updater). A release ships the SHELL: it
carries no agent, no vault and no index, so what a bump changes is the window
and its update feed.
