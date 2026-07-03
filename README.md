# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo. The product is an Electron desktop app over a local
backend, plus a marketing site.

## Layout

```
apps/              Shippable artifacts
  desktop/         Thin Electron shell over host + app (@repo/desktop)
  web/             TanStack Start marketing site on Cloudflare Workers (landing page only)
packages/          Libraries
  app/             Portable UI — the whole workspace as a React app (@repo/app)
  features/        Isomorphic contract: Bridge/IPC registry, domain schemas (@repo/features)
  host/            Platform-agnostic node backend: vault, pi, delegation, executor, voice (@repo/host)
  ui/              Shared UI components (@repo/ui)
  agent-runtime/   Filesystem + install primitives for the agent (@repo/agent-runtime)
  pi-driver/       Wrapper around pi-coding-agent — stable surface for app code (@repo/pi-driver)
```

Workspace `README.md`s:

| Workspace                | README                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| `apps/desktop`           | [Electron shell — process boundary, packaging](./apps/desktop/README.md)     |
| `apps/web`               | [static marketing site](./apps/web/README.md)                                |
| `packages/app`           | [portable UI — Bridge-injected workspace](./packages/app/README.md)          |
| `packages/features`      | [isomorphic contract — IPC registry, schemas](./packages/features/README.md) |
| `packages/host`          | [node backend — createHost, HostPlatform](./packages/host/README.md)         |
| `packages/agent-runtime` | [install / seed / run-cli primitives](./packages/agent-runtime/README.md)    |
| `packages/pi-driver`     | [pi-coding-agent wrapper](./packages/pi-driver/README.md)                    |
| `packages/ui`            | [shared design system](./packages/ui/README.md)                              |

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
