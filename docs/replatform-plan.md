# Re-platform plan — adopt the open-knowledge structure

Status: **proposed** (Phase 0). This is the roadmap for restructuring inteligir
to follow [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge)'s
web-first, multi-package architecture — while keeping the two things we
deliberately do **not** copy from them: **Plate** (not Tiptap) and the
**bundled pi agent harness** (not external-harness-only).

---

## 1. Goal & constraints

Re-platform from "Electron app is the product, web is a landing page" to
open-knowledge's model: **a portable web app is the product**, rendered by
both a browser and a thin Electron shell, and runnable anywhere via
`npx`.

Locked decisions (from the scoping conversation):

- **Web-first, portable UI.** The editor UI runs in a plain browser, in an
  Electron shell, and behind a local `npx` server. Same React code, three
  hosts. This is the core of the re-platform.
- **Keep Plate (platejs).** We do _not_ migrate the editor to Tiptap/ProseMirror.
- **Keep the pi harness.** The bundled in-app agent (pi + OpenAI OAuth),
  delegation, voice, inline-AI, and the executor/browser/peekaboo extensions
  all stay. They are our differentiators.
- **Also add external-harness AI.** In addition to bundled pi, expose an MCP
  server + skills so the user's own Claude Code / Codex / Cursor can edit the
  vault (open-knowledge's model). The two coexist.
- **Our conventions, their structure.** Keep pnpm + oxlint + oxfmt + knip +
  Turborepo. Do **not** adopt Bun, changesets, or Lingui i18n (i18n optional
  later). Adopt their _package layout_ (`core` / `app` / `desktop` / `server` /
  `cli` / `plugin`).
- **Priority features:** wiki-links + backlinks + graph, tabs + rich content
  (Mermaid / KaTeX / PDF / embeds), external-harness AI.

Out of scope unless later requested: Tiptap, real-time Yjs/Hocuspocus
collaboration, MDX-compile pipeline, i18n.

---

## 2. Why this is tractable — the Bridge seam

The renderer is already a **pure browser React app**. It imports nothing from
`main/` (lint-enforced) and reaches node only through
`window.desktopBridge`, an object whose entire shape is _derived_ from one
transport-agnostic registry:

- `src/shared/ipc-registry.ts` — `IPC` pairs each channel with a TypeBox
  payload schema + a result/event type. `DesktopBridge` is a pure type
  derivation from it.
- `src/preload/*.ts` — folds that same `IPC` registry into Electron
  `ipcRenderer.invoke/send/on` calls.

Nothing in `IPC` is Electron-specific. A **WebSocket server can fold the exact
same registry** into `socket.send` / request-response calls and satisfy the
identical `Bridge` type — so the UI runs unchanged in a browser. The
re-platform is therefore mostly _relocation + one new transport_, not a
rewrite.

```
                    ┌───────────────── packages/core ─────────────────┐
                    │  IPC registry (Bridge contract) + domain schemas │
                    │  + pure logic (markdown-doc, find-task-line, …)  │
                    └──────────────────────┬──────────────────────────┘
                                           │ implemented-by / typed-by
        ┌──────────────── packages/app (Plate UI, browser React) ──────────────┐
        │            consumes an injected `Bridge` — no host imports            │
        └───────┬───────────────────────────────────────────────┬──────────────┘
                │ Bridge over Electron IPC        Bridge over WebSocket │
        ┌───────┴────────┐                             ┌───────────────┴────────┐
        │ packages/desktop│  ── both wrap ──▶ packages/host ◀── both wrap ──     │ packages/server
        │ (Electron shell)│   (vault, pi sessions, delegation, executor, voice) │ (HTTP+WS, serves app)
        └────────────────┘                                                       └────────┬────────┘
                                                                          packages/cli ── npx launcher
                                                                          packages/plugin ─ MCP + skills
```

---

## 3. Target package graph (mapped to today's files)

| open-knowledge              | ours (target)         | Contents                                                                                                                                                                                                                                                                        | Comes from today                                                                               |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `core`                      | `packages/core`       | Isomorphic contracts + pure logic: the Bridge/IPC registry, domain schemas (vault, delegation, executor, voice, inline-ai, app-state), agent-event types + parser, and pure helpers (`markdown-doc.ts`, `find-task-line.ts`, `vault-tree.ts`). No node/electron imports.        | `apps/desktop/src/shared/*`, plus pure files lifted from `renderer/editor` + `main/delegation` |
| `app`                       | `packages/app`        | The portable Plate UI: editor, workspace, sidebar, composer/chat, command palette, settings, voice UI, onboarding. Depends on `core` + a `Bridge` injected at runtime. Vite → static assets.                                                                                    | `apps/desktop/src/renderer/*`                                                                  |
| `desktop`                   | `packages/desktop`    | Electron shell: `main` + `preload`. Provides the Bridge over IPC and loads the `app` build. Keeps electron-updater, native voice, packaging.                                                                                                                                    | `apps/desktop/src/main`, `src/preload`, `src/agent` (see host note)                            |
| _(part of `core`/`server`)_ | `packages/host`       | **New split.** The node backend as a platform-agnostic library: `VaultManager`, pi session wiring (`agent-gateway`, `session-history`), delegation manager + background agent, executor daemon/client, voice models, agent extensions. Consumed by both `desktop` and `server`. | `apps/desktop/src/main/*` (minus Electron wiring) + `apps/desktop/src/agent/*`                 |
| `server`                    | `packages/server`     | Node HTTP + WebSocket server: serves the `app` static build and exposes the `IPC` registry over WS, wired to `host`. Enables browser + Linux/Windows/Intel-mac.                                                                                                                 | new                                                                                            |
| `cli`                       | `packages/cli`        | `npx inteligir`: pick/init a vault folder, boot `server`, open the browser; also install MCP/skill config for detected harnesses (delegates to `plugin`).                                                                                                                       | new                                                                                            |
| `plugin`                    | `packages/plugin`     | External-harness integration: an MCP server exposing vault tools (read/write/search/list) + a skills bundle, plus config-writers that register it into Claude Code / Codex / Cursor. Wraps `host`'s vault logic.                                                                | new                                                                                            |
| `native-config`             | folded into `desktop` | Native packaging/config. Small; no separate package needed initially.                                                                                                                                                                                                           | `apps/desktop` build config                                                                    |
| `docs` (Next.js)            | `apps/web` → `docs`   | Reuse our existing Next.js `apps/web`; grow it into the docs + marketing site.                                                                                                                                                                                                  | `apps/web`                                                                                     |

The one structural refactor beyond pure relocation is the **`host` split**:
today the node backend lives in `apps/desktop/src/main`, tightly bound to
Electron. To serve it from both the Electron shell _and_ a standalone server,
that logic becomes a platform-agnostic node library each shell wires to its own
transport. This is the linchpin of the whole effort.

---

## 4. Phased sequencing

Each phase is a self-contained, **build-green** PR (`pnpm typecheck && pnpm lint
&& pnpm test && pnpm knip && pnpm build`). No phase leaves the desktop app
broken.

- **Phase 0 — this document.** Agree the target and sequencing.
- **Phase 1 — `packages/core`.** Move `src/shared/*` + the pure helpers into a
  new isomorphic package. Rename `DesktopBridge` → `Bridge` (keep a
  `DesktopBridge` alias for compat). Desktop re-exports from `core`. Pure
  relocation, zero behavior change. _Highest-leverage, lowest-risk first step._
- **Phase 2 — `packages/app`.** Extract `src/renderer/*` into a Vite React
  package that takes a `Bridge` via context/prop instead of reading
  `window.desktopBridge` directly. The Electron shell injects the IPC-backed
  bridge and loads this build. Electron still ships and works.
- **Phase 3 — `packages/host`.** Lift the node backend (vault, pi wiring,
  delegation, executor, voice, agent extensions) out of `main` into a
  platform-agnostic library. `desktop/main` becomes thin: Electron lifecycle +
  IPC transport over `host`.
- **Phase 4 — `packages/server` + `packages/cli`.** WS transport that serves
  `app` and drives `host`; `cli` boots it via `npx` and opens a browser. First
  moment the product runs outside Electron (Linux/Windows/browser).
- **Phase 5 — `packages/plugin` (external-harness AI).** MCP server + skills
  bundle over `host`'s vault; `cli`/onboarding writes harness config
  (`.mcp.json`, Claude/Codex/Cursor settings). Coexists with bundled pi.
- **Phase 6 — priority features.** Tabs (multi-doc), rich content
  (Mermaid/KaTeX/PDF/embeds in Plate), wiki-links + backlinks + graph.
- **Phase 7 — distribution & docs.** Publish the `cli` to npm; keep
  electron-updater for the DMG; grow `apps/web` into the docs site.

---

## 5. Priority-feature design notes

- **Wiki-links + backlinks + graph.** Add a `[[wiki-link]]` remark plugin to
  `markdown-doc.ts` and a Plate link node; build a backlink index in `host`
  (scan the vault, resolve link targets); render a graph-view component in
  `app`. **Invariant change:** CLAUDE.md currently states "notes are plain GFM,
  no wiki-links." This phase deliberately revises that — the wiki-link syntax
  must still round-trip byte-stably through `markdown-doc.ts`.
- **Tabs.** The workspace opens a single note today
  (`workspace/open-note-flush.ts`). Add a tab store (zustand) and a tab bar;
  `vault-context` manages N editor controllers keyed by path.
- **Rich content.** Plate plugins for Mermaid and KaTeX math (we already have
  code-block + table); a generic embed/HTML node; PDF via a viewer node. MDX
  (compile step) is intentionally deferred — flag before starting.
- **External-harness AI.** `plugin`'s MCP server exposes vault read/write/
  search/list tools; a skills bundle ships alongside; `cli` writes the harness
  config so Claude Code / Codex / Cursor pick it up. Bundled pi is unaffected.

---

## 6. Invariants to preserve

- **Byte-stable markdown** (`markdown-doc.ts`) — must keep holding through
  `core`, and now also server-side writes.
- **pi runs node-side.** In server mode, pi + OAuth run on the local `host`
  (localhost `npx`). Safe for local use; **any hosted/multi-user deployment
  needs a separate auth story** — out of scope here, but do not accidentally
  expose the bridge WS without an auth gate.
- **Electron-only deps stay out of `core`/`app`.** `electron-updater`,
  `sherpa-onnx-node` (native voice), and packaging live in `desktop`/`host`
  only. Voice inference is host-side; the browser streams audio over the bridge.
- **Boundary lint.** Keep the "`agent`/`app` never import `main`/electron"
  rule; extend it to "`core`/`app` never import node built-ins."

---

## 7. What we deliberately do NOT adopt from open-knowledge

- **Tiptap/ProseMirror + CodeMirror editor** — we keep Plate.
- **Yjs / Hocuspocus real-time collaboration** — not in scope (single-user +
  git sync is the collaboration story if/when we add it).
- **Bun, changesets, Lingui** — we keep pnpm + our release skill + oxlint/oxfmt;
  i18n is a later, optional consideration.
