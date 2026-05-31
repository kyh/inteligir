# Agent Instructions

## Project Overview

**inteligir** - An artificially intelligent operating system.

Turborepo monorepo with Next.js marketing site + shared packages.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15, React 19, Tailwind CSS 4
- **API**: tRPC, better-auth
- **Database**: Supabase + Drizzle ORM + PostgreSQL
- **UI**: shadcn/ui (Base UI), lucide-react, vaul, sonner
- **Desktop**: Electron + electron-vite (@repo/desktop)
- **AI Agent**: pi coding agent framework (@mariozechner/pi-coding-agent)

## Workspace Structure

```
apps/
  web/           # Marketing site + docs (@repo/web)
  desktop/       # Electron app — agent UI, voice, extensions (@repo/desktop)
packages/
  api/           # tRPC routers, auth (@repo/api)
  db/            # Drizzle schema, Supabase (@repo/db)
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
pnpm lint             # Lint all
pnpm lint:fix         # Lint fix all
pnpm format           # Format check
pnpm format:fix       # Format fix

# Database
pnpm db:start         # Start local Supabase
pnpm db:stop          # Stop local Supabase
pnpm db:push          # Push schema to local
pnpm db:push-remote   # Push schema to prod
pnpm db:reset         # Reset local DB
```

## Verifying Changes

Use the **agent-browser** skill to check things in a running app — it drives
both the web app (browser) and the desktop app (Electron). Don't claim a UI
change works without driving it; type/test passing isn't feature-correct.

- Desktop dev exposes a remote-debugging port: `pnpm dev:desktop` runs
  electron-vite with `--remoteDebuggingPort 9222`. Point agent-browser at it
  to inspect/automate the Electron renderer.

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```

## Runtime UI architecture (@repo/desktop)

The desktop renderer is a small OS shell over an agent. The model splits
"what's installed" (widget definitions) from "what's open" (placed instances);
the shell is one of several surfaces over that model.

### Three UI tiers

1. **Shell chrome** (`renderer/shell/{panel-grid,floating-layer,floating-window,bottom-dock}.tsx`)
   — React, owned by us. Not a widget; can't be rearranged by the user.
2. **Built-in React widgets** (`renderer/shell/builtin-widgets.tsx` → `BUILTIN_WIDGET_UI`)
   — chat, widgets, tasks, extensions, settings. `WidgetDef.source.kind === "builtin-react"`.
   Trusted, privileged access to IPC and integrations; ship with the binary.
   The Extensions panel is the consolidated surface for tool providers (MCP/
   OpenAPI/GraphQL/Google sources), OAuth connections, secrets, and the
   read-only skills list. The Widgets panel manages custom JSON-UI defs.
3. **JSON-UI widgets** (`renderer/shell/widget-viewer.tsx` rendering a `WidgetSpec`)
   — agent-authored or user-added. `WidgetDef.source.kind === "json-ui"`. Constrained
   to a fixed catalog (`shared/widget-spec.ts`: 12 components, 9 actions). The only
   path the agent can use to extend the UI.

### Kernel

`main/shell.ts` (`ShellManager`) is the single writer. It persists
`Shell = { version, customDefs, instances, archivedStates }` at
`~/.inteligir/runtime-ui.json` through a Zod-validated `JsonStore`. Reads on
the renderer side go through `getShellSnapshot()` (always live); writes go
through `getWritableShell()`, which returns `null` while shell writes are
suspended (post-logout, between `resetShellCache()` and `resumeShellWrites()`).

- `WidgetInstance.placement` is a discriminated union: `{ surface: "pinned",
  geometry }` (grid) or `{ surface: "floating", rect, z }` (window).
- `Shell.archivedStates` is the per-widgetId state we last saw before an
  unplace — re-placing the same widget restores it. Cleared on `deleteWidget`
  and on empty-state unplace.
- Built-ins are singletons. JSON-UI widgets are multi-instance. The dock
  ignores the archive when a sibling is already live.

### Flush protocol (main ↔ renderer)

Renderer-owned widget state (json-render store) is debounced (400ms) and
persisted via `SHELL_SET_STATE`. Before any main-side action that would
remount or destroy a viewer (unplace, delete, surface switch), main asks
each window to flush:

1. Main broadcasts `SHELL_FLUSH_REQUEST { instanceId, requestId }` to every
   live `BrowserWindow` and tracks pending `webContents.id`s.
2. Each renderer's `initFlushBridge` (wired at startup in `main.tsx`) calls
   the registered `flushPersist` (returns `boolean`: persisted vs failed)
   and replies with `SHELL_FLUSH_ACK { requestId, persisted }`.
3. Main resolves true only when every window has acked with `persisted=true`;
   any false or a 2000ms timeout resolves false. Wrappers in
   `main/lib/shell-actions.ts` (`unplaceWithFlush`/`placeWithFlush`/
   `deleteWithFlush`) throw `FlushFailedError` on failure so the agent and
   IPC handlers can distinguish "widget not found" from "flush failed."

### Agent surface

`agent/ui/extension.ts` registers a single `manage_ui` tool with actions:
`list`, `catalog`, `read`, `install` (installs **and** pins the new def in
one call — the common "make me a widget" path), `update`, `patch` (RFC 6902
against a custom def's spec, with prototype-pollution guards in
`shared/json-pointer.ts`), `delete`, `place` (additional instance of an
already-installed def), `unplace`. All write actions short-circuit when the
shell is suspended.

The tool's `parameters` schema is intentionally a flat `Type.Object` with
`action` as a discriminator and the union of all per-action fields as
optional. `Type.Union([...Type.Object])` compiles to JSON Schema `anyOf`
without a top-level `type` field, which OpenAI silently rejects on every
turn — `agent/extension.ts::validateToolParametersSchema` runs at extension
registration to catch that class of bug at startup rather than runtime.

