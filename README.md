# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo. The product runs two ways over the same backend + UI: an
Electron desktop app and the browser via an `inteligir` CLI. Plus a static
marketing site.

## Layout

```
apps/
  web/             Next.js static marketing site (landing page only)
packages/
  app/             Portable UI — the whole workspace as a browser React app (@repo/app)
  core/            Isomorphic contract: Bridge/IPC registry, domain schemas (@repo/core)
  host/            Platform-agnostic node backend: vault, pi, delegation, executor, voice (@repo/host)
  server/          Loopback HTTP+WS host: folds the registry over WS, serves the app build (@repo/server)
  cli/             `inteligir <vault>`: boot host+server, open the browser (@repo/cli)
  desktop/         Thin Electron shell over host + app (@repo/desktop)
  ui/              Shared UI components (@repo/ui)
  agent-runtime/   Filesystem + install primitives for the agent (@repo/agent-runtime)
  pi-driver/       Wrapper around pi-coding-agent — stable surface for app code (@repo/pi-driver)
```

Workspace `README.md`s:

| Workspace                | README                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- |
| `packages/desktop`       | [Electron shell — process boundary, packaging](./packages/desktop/README.md) |
| `packages/host`          | [node backend — createHost, HostPlatform](./packages/host/README.md)         |
| `packages/server`        | [browser host — loopback HTTP+WS](./packages/server/README.md)               |
| `packages/cli`           | [`inteligir` launcher](./packages/cli/README.md)                             |
| `packages/agent-runtime` | [install / seed / run-cli primitives](./packages/agent-runtime/README.md)    |
| `packages/pi-driver`     | [pi-coding-agent wrapper](./packages/pi-driver/README.md)                    |
| `packages/ui`            | [shared design system](./packages/ui/README.md)                              |
| `apps/web`               | [static marketing site](./apps/web/README.md)                                |

`docs/replatform-plan.md` is the architecture plan of record. `CLAUDE.md`
(root) is read by Claude Code / agents working in the repo — quality gates,
dev-loop tools, conventions.

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
