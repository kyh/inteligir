# Inteligir

> An AI-native notes app — Obsidian with an agent.

Turborepo monorepo. The product is an Electron desktop app over a local
backend, plus a marketing site.

## Layout

```
apps/              Shippable artifacts
  desktop/         Electron app — main/preload + the product UI (renderer) (@repo/desktop)
  mobile/          Expo companion — sync + read + light-edit, no agent (@repo/mobile)
  web/             ONE CF Worker (@repo/web) — the TanStack Start marketing site
                   plus the backend: Better Auth (D1) + the vault-sync
                   coordinator (Durable Object + R2), same origin
packages/          Libraries
  notes/           Pure platform-neutral domain — sync engine, knowledge, markdown (@repo/notes)
  bridge/          Iso wire contract — Bridge/IPC registry, ws client, schemas (@repo/bridge)
  installer/       Generic CLI provisioning (@repo/installer)
  agent/           The pi capability (@repo/agent)
  storage/         Node fs/json substrate over ~/.inteligir (@repo/storage)
  vault/           VaultManager — the user's markdown folder (@repo/vault)
  voice/           Voice capability — sherpa-onnx STT dictation (@repo/voice)
  connectors/      MCP/connectors capability + executor daemon (@repo/connectors)
  sync/            Desktop vault-sync adapters (@repo/sync)
  server/          Node backend — vault, delegation, connectors, voice, boot (@repo/server)
  ui/              Shared UI components (@repo/ui)
```

Workspace `README.md`s — every workspace has one:

| Workspace             | README                                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/desktop`        | [Electron shell — process boundary, packaging](./apps/desktop/README.md)    |
| `apps/mobile`         | [Expo companion — sync, read, remote chat](./apps/mobile/README.md)         |
| `apps/web`            | [inteligir.com — marketing site + the backend Worker](./apps/web/README.md) |
| `packages/notes`      | [pure domain — sync, knowledge, markdown](./packages/notes/README.md)       |
| `packages/bridge`     | [iso wire contract — IPC registry, ws](./packages/bridge/README.md)         |
| `packages/agent`      | [the pi capability + harness quarantine](./packages/agent/README.md)        |
| `packages/server`     | [node backend — vault, delegation, boot](./packages/server/README.md)       |
| `packages/vault`      | [VaultManager — confined markdown IO](./packages/vault/README.md)           |
| `packages/storage`    | [node fs/json substrate over ~/.inteligir](./packages/storage/README.md)    |
| `packages/sync`       | [desktop vault-sync adapters](./packages/sync/README.md)                    |
| `packages/connectors` | [MCP connectors + executor daemon](./packages/connectors/README.md)         |
| `packages/voice`      | [voice capability — STT + TTS proxy](./packages/voice/README.md)            |
| `packages/installer`  | [generic checksum-verified CLI install](./packages/installer/README.md)     |
| `packages/ui`         | [shared design system](./packages/ui/README.md)                             |

**[`AGENTS.md`](./AGENTS.md) is the guide for coding agents** — quickstart, the
platform matrix of what is headlessly verifiable, and the runtime recipes.
**[`docs/development.md`](./docs/development.md) is the dev guide** — the
ways to run the app, ports/shared state, gates, verification, and
change checklists. `CLAUDE.md` (root) holds the architecture summary,
conventions, and the durable decisions.

## Common commands

```bash
pnpm dev              # All workspaces
pnpm dev:web          # Web only
pnpm dev:desktop      # Desktop only
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
