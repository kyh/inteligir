# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo. The product is an Electron desktop app over a local
backend, plus a marketing site.

## Layout

```
apps/              Shippable artifacts
  desktop/         Electron app — main/preload + the product UI (renderer) (@repo/desktop)
  mobile/          Expo companion — sync + read + light-edit, no agent (@repo/mobile)
  web/             TanStack Start marketing site on Cloudflare Workers (landing page only)
  cloud/           CF Worker — Better Auth + vault-sync coordinator (@repo/cloud)
packages/          Libraries
  notes/           Pure platform-neutral domain — sync engine, knowledge, markdown (@repo/notes)
  bridge/          Iso wire contract — Bridge/IPC registry, ws client, schemas (@repo/bridge)
  installer/       Generic CLI provisioning (@repo/installer)
  agent/           The pi capability (@repo/agent)
  server/          Node backend — vault, delegation, connectors, voice, boot (@repo/server)
  ui/              Shared UI components (@repo/ui)
```

Workspace `README.md`s:

| Workspace             | README                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| `apps/desktop`        | [Electron shell — process boundary, packaging](./apps/desktop/README.md)   |
| `apps/web`            | [static marketing site](./apps/web/README.md)                              |
| `packages/server`     | [node backend — vault, delegation, boot](./packages/server/README.md)      |
| `packages/server/src` | [node backend — createHost, HostPlatform](./packages/server/src/README.md) |
| `packages/ui`         | [shared design system](./packages/ui/README.md)                            |

**[`docs/development.md`](./docs/development.md) is the dev guide** — the
ways to run the app, ports/shared state, gates, verification, and
change checklists. `CLAUDE.md` (root) is read by Claude Code / agents working
in the repo — architecture summary + conventions.

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
