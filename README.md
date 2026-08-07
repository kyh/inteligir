# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo. The product is one Cloudflare Worker; the desktop and mobile
apps are shells around it.

## Layout

```
apps/                Shippable artifacts
  web/               THE PRODUCT (@repo/web) — ONE CF Worker: the TanStack Start
                     marketing site, Better Auth (D1), and /app — the workspace
                     over a per-user UserHost Durable Object holding the vault
                     (manifest in its SQLite, bytes in R2), same origin
  web/container/     The agent image (@repo/agent-container) — pi in a per-user
                     Cloudflare Sandbox the UserHost drives
  desktop/           Electron SHELL (@repo/desktop) — a window on the hosted app,
                     the inteligir:// scheme, a tray, shell auto-update
  mobile/            Expo (@repo/mobile) — a signed-in shell
packages/            Libraries
  notes/             Pure platform-neutral domain — knowledge + markdown (@repo/notes)
  bridge/            Iso wire contract — IPC registry, ws client, grants (@repo/bridge)
  ui/                Shared UI components (@repo/ui)
  editor/            The note editor — Plate kits, the markdown round-trip (@repo/editor)
  workspace/         The product UI + the fixture Bridge (@repo/workspace)
tools/
  repo-guards/       Derived fitness tests over the repo itself
```

Workspace `README.md`s:

| Workspace            | README                                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| `apps/web`           | [inteligir.com — the whole product Worker](./apps/web/README.md)           |
| `apps/web/container` | [the agent image](./apps/web/container/README.md)                          |
| `apps/desktop`       | [Electron shell — the window and its one origin](./apps/desktop/README.md) |
| `apps/mobile`        | [Expo — a signed-in shell](./apps/mobile/README.md)                        |
| `packages/notes`     | [pure domain — knowledge + markdown](./packages/notes/README.md)           |
| `packages/bridge`    | [iso wire contract — IPC registry, ws](./packages/bridge/README.md)        |
| `packages/ui`        | [shared design system](./packages/ui/README.md)                            |
| `packages/editor`    | [the note editor](./packages/editor/README.md)                             |
| `packages/workspace` | [the product UI](./packages/workspace/README.md)                           |

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — quickstart, the
platform matrix of what is headlessly verifiable, and the runtime recipes.
**[`apps/web/README.md`](./apps/web/README.md) is the product's own guide** —
every route, the Durable Object, the local loop and the owner-only deploy.
[`docs/development.md`](./docs/development.md) is the shorter cross-client dev
loop, and [`docs/privacy.md`](./docs/privacy.md) states where notes actually
live. `CLAUDE.md` (root) holds the architecture summary, conventions, and the
durable decisions.

## Common commands

```bash
pnpm dev:web          # The product — localhost:5174
pnpm dev:desktop      # The Electron shell
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

`format:fix` runs FIRST and never after the gates — see `docs/development.md`.
