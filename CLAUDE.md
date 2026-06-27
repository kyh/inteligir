# Agent Instructions

## Project Overview

**inteligir** — an AI-native notes app (Obsidian-with-an-agent). You pick a
directory (a _vault_); your content is local markdown files on disk. It's
AI-native two ways: chat to an agent that edits those files, and highlight a
checkbox to _delegate_ it to a background agent that does the task and writes the
result back.

Turborepo monorepo: an Electron desktop app (the product) + a static Next.js
marketing site + shared packages.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Desktop**: Electron + electron-vite (@repo/desktop) — the product
- **Editor**: Plate (platejs) rich markdown + a raw textarea fallback
- **UI**: shadcn/ui (Base UI), lucide-react, sonner, zustand
- **Web**: Next.js 16, React 19, Tailwind CSS 4 (static marketing site, no backend)
- **AI Agent**: pi coding agent framework (@mariozechner/pi-coding-agent)

The agent runs locally in the desktop app. There is no server-side API or
database — auth is provider OAuth (OpenAI), handled by pi on-device. The vault is
just a folder of markdown the user owns; the agent reaches it through a `./vault`
symlink in its workspace and edits files with its native file tools.

## Workspace Structure

```
apps/
  web/           # Static marketing site (@repo/web) — landing page only
  desktop/       # Electron app — the notes product (@repo/desktop)
packages/
  ui/            # Shared UI components (@repo/ui)
  agent-runtime/ # CLI install/seed/run helpers for agent extensions (@repo/agent-runtime)
  pi-driver/     # pi-coding-agent wrapper: sessions, auth, models (@repo/pi-driver)
```

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev:web          # Dev web app only
pnpm dev:desktop      # Dev desktop app only
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt)
```

## Verifying Changes

Use the **agent-browser** skill to drive a running app — both the web app
(browser) and the desktop app (Electron). Don't claim a UI change works without
driving it; type/test passing isn't feature-correct.

- Desktop dev exposes a remote-debugging port: `pnpm dev:desktop` runs
  electron-vite with `--remoteDebuggingPort 9222`. `agent-browser connect 9222`
  attaches to the Electron renderer.
- Kill stale instances between runs — a leftover Electron/executor process holds
  ports 9222 and 47888 and the next launch can't bind them.

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build
```

## Desktop architecture (@repo/desktop)

Three processes: **main** (Electron), **preload**, **renderer** (React). The
`agent/` boundary never imports `main/` — it's lint-enforced; main composes
capabilities and hands the agent an injected `AgentPorts` (`{ executor }`).

### Data model — the vault

`main/vault.ts` (`VaultManager`) owns the vault: a user-chosen folder whose
markdown files are canonical. It reads through to disk (never quarantines user
files), writes atomically, watches for changes (broadcasts `onVaultChanged`), and
maintains a `./vault` symlink in the agent workspace so the agent's file tools
find it regardless of where the user put it. `~/.inteligir` holds only app state
(auth, sessions, ui-state, delegations) via versioned `JsonStore`s — never note
content. Notes are plain GitHub-flavored markdown (no wiki-links).

### Renderer — one fixed workspace

`renderer/workspace/workspace-page.tsx` is the only surface: **Sidebar (file
tree) | Editor | Chat**, settings behind a dialog. There is no widget grid.

- `workspace/vault-context.tsx` — a `VaultProvider` owning the editor controller
  (`editor/vault-editor.ts`), the file listing, and all vault actions
  (open/create/rename/delete/flush). Sidebar + editor + chat consume `useVault()`.
- `editor/markdown-doc.ts` is the byte-stability brain: Plate's markdown
  round-trip is normalizing but **idempotent**, so a _canonical_ file
  (`roundTrip(raw) === raw`) re-serializes to a minimal diff after an edit. The
  editor pane opens Rich for canonical files and Raw (byte-exact) + a one-click
  **Format** for the rest. `editor/block-list.tsx` renders list markers +
  todo checkboxes (and the per-checkbox Delegate affordance).

### Delegation — `main/delegation/`

A checkbox's "Delegate" → `delegation-manager.ts` (versioned `JsonStore` +
event-driven serialized queue) runs it on `background-agent.ts` (a second pi
session on `BACKGROUND_SESSION_DIR`). The agent edits the file via `./vault`,
checks the box, and appends a result; the watcher refreshes the editor. Status
streams to inline badges (`onDelegationsUpdated`). `find-task-line.ts` is the
pure, content-addressed locator (item text + nearest heading + section).

### Agent surface — `agent/`

Extension bundles are auto-discovered from `agent/<name>/extension.ts` and
receive `AgentPorts` at register time — adding/removing a capability is one
folder. `executor/` is the MCP/connectors capability. `validateToolParametersSchema`
rejects tool schemas that aren't a top-level `Type.Object` (OpenAI silently
rejects `anyOf`-rooted schemas). The chat agent edits notes with pi's native file
tools pointed at `./vault` — no custom edit tool. Chat is a single persistent
thread; the open note is auto-attached as context (agent-side only) so "edit this
note" resolves without naming the file. `Cmd+K` rolls a fresh thread.

### IPC

`shared/ipc-registry.ts` is the single source of truth: each channel pairs a
TypeBox payload schema with a result/event type, and the preload bridge +
`DesktopBridge` type are both derived from it. Add a channel = add a registry
entry; handlers go through `main/lib/ipc-handler.ts::handle`.
