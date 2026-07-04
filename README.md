# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo. The product is an Electron desktop app over a local
backend, plus a marketing site.

## Layout

```
apps/              Shippable artifacts
  desktop/         Electron app — main/preload + the product UI (renderer) (@repo/desktop)
  web/             TanStack Start marketing site on Cloudflare Workers (landing page only)
packages/          Libraries
  features/        Isomorphic contract + node backend (@repo/features)
                     src/         iso — Bridge/IPC registry, schemas, knowledge engine, markdown
                     src/server/  node — vault, pi agent, delegation, executor, voice, handlers
  ui/              Shared UI components (@repo/ui)
```

Workspace `README.md`s:

| Workspace                      | README                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `apps/desktop`                 | [Electron shell — process boundary, packaging](./apps/desktop/README.md)            |
| `apps/web`                     | [static marketing site](./apps/web/README.md)                                       |
| `packages/features`            | [contract + backend — iso `src`, node `src/server`](./packages/features/README.md)  |
| `packages/features/src/server` | [node backend — createHost, HostPlatform](./packages/features/src/server/README.md) |
| `packages/ui`                  | [shared design system](./packages/ui/README.md)                                     |

**[`docs/development.md`](./docs/development.md) is the dev guide** — the
ways to run the app, ports/shared state, gates, verification, and
change checklists. `docs/replatform-plan.md` is the architecture decision
record. `CLAUDE.md` (root) is read by Claude Code / agents working in the
repo — architecture summary + conventions.

## Common commands

```bash
pnpm dev              # All workspaces
pnpm dev:web          # Web only
pnpm dev:desktop      # Desktop only
pnpm build
pnpm typecheck
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm test
pnpm knip             # Dead exports / unused deps
```

## Quality gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build
```
