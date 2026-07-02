# Re-platform plan — adopt the open-knowledge structure

Status: **executed** (2026-07-02 — all phases shipped: #351 core, #353 app,
#354 host, #355 server+cli, #356 desktop, #357/#358/#360/#361 editor overhaul,
#363 snapshots, #364/#366 knowledge suite, #365 AI surface; #362 fixed the
fixture/format CI regime). Kept as the decision record. Originally: roadmap
for restructuring inteligir to follow
[inkeep/open-knowledge](https://github.com/inkeep/open-knowledge)'s web-first,
multi-package architecture, with the editor rebuilt to
[Potion](https://pro.platejs.org) parity on Plate and styled with the Fluid
Functionalism system already in `@repo/ui`.

---

## 1. Goal & locked decisions

Re-platform from "Electron app is the product, web is a landing page" to:
**a portable web app is the product**, rendered by a browser, a thin Electron
shell, and a local `npx` server.

Decisions locked in the grilling session (each was an explicit choice):

- **Hybrid build strategy.** Keep the hard-won host logic — vault,
  `markdown-doc` byte-stability, pi wiring, voice STT/TTS, delegation,
  executor — and port it. **Greenfield the UI**: a fresh `packages/app` built
  from Potion's editor kits + Fluid components, with inline-AI / voice /
  chat UI ported into it. The old renderer keeps working on `main` until
  cutover; the new app grows beside it.
- **Disk-canonical, CRDT-ready seams.** Bytes on disk stay canonical (no Yjs
  layer now). The Bridge doc channel carries explicit doc-level updates
  (path + content + revision) rather than implicit file writes, so a CRDT
  transport can replace the payload later without changing consumers.
  Agent edits land as watcher-driven refreshes, as today.
- **MDX vault, fixed component vocabulary.** Files become MDX with a known
  component set — callout, toggle, columns, embed (YouTube / tweet / PDF),
  date — each with a native Plate node, plus md-native extensions: `$$` math,
  mermaid fences, `[[wiki-links]]`, `> [!NOTE]` alerts. Unknown JSX or
  unparseable files (MDX is stricter than md: raw `<` / `{` can fail) fall
  back to the existing Raw mode. Byte-stable round-trip must keep holding
  for the whole vocabulary.
- **Browser-first development.** Build `packages/app` + `packages/server`
  first and develop in a plain browser; re-wrap the Electron shell near the
  end. The desktop DMG is effectively frozen on `main` during the rebuild.
- **Full Potion AI surface, backed by pi.** AI menu with intent
  classification (generate vs edit), copilot ghost-text (tab-accept), and
  AI-suggestions mode (track-changes marks, accept/reject per change) — all
  running on pi sessions, not HTTP AI routes. Suggestion/ai marks are
  transient: never serialized to disk.
- **External-harness AI: deferred.** No MCP server / skills bundle / harness
  config-writers this round; bundled pi is the only agent. `packages/plugin`
  is cut; `cli` simplifies to "pick vault, boot server, open browser".
- **No built-in version history.** Users git their own vaults. No shadow
  repo, no checkpoint/restore. (Revisit if agent-edit safety bites.)
- **Fluid tokens, Potion layout.** Fluid Functionalism owns the theme
  (colors, elevation, motion). From Potion take structure — centered ~700px
  editor column, per-block placeholders, page-title-as-H1, toolbar layouts —
  restyled with Fluid tokens. One design system.
- **Menus rebuilt on Base UI.** Potion's ariakit menus (slash, block
  context, turn-into, combobox pickers) are re-implemented on Base UI
  primitives. No third headless-UI dependency.
- **Search: lexical host index.** Orama-style full-text + link index in
  `packages/host`, exposed over the Bridge; powers palette, backlinks,
  graph. No semantic embeddings (no second credential).
- **Voice rides the Bridge.** Voice channels (STT PCM streaming, TTS) are
  part of the Bridge contract so browser and Electron both get voice; STT
  (sherpa-onnx) and the TTS proxy stay host-side.
- **Wiki-links, full scope.** `[[note]]` + `[[note|alias]]` with
  Obsidian-style resolution, `![[transclusion]]` embeds, rename-rewrite
  across the vault, and a `[[`-triggered autocomplete picker.
- **Chat stays BottomComposer.** The bottom-pinned composer + delegation
  dock port as-is. No side chat panel.
- **Keep Plate. Keep pi + voice + delegation + executor/browser/peekaboo.**
  Unchanged from v1 — these are the differentiators.
- **Our conventions, their structure.** pnpm + oxlint + oxfmt + knip +
  Turborepo. No Bun, changesets, or Lingui. Adopt the package layout only.
- **Feature order: no fixed order** — work the feature list until done.
- **Pre-launch, zero tech debt.** The app is unlaunched: no compat shims or
  aliases, no dual old/new code paths kept alive, old renderer deleted at
  cutover. Clean cuts over migration safety.
- **Vault files stay `.md`.** MDX vocabulary parses inside `.md` files; no
  `.mdx` extension.
- **Delegation snapshots.** Host snapshots a file before any
  background-agent write (under `~/.inteligir`), restorable — cheap undo
  for agent edits, without a full history feature.
- **Ghost-text uses a fast model** (configurable, via the same pi auth) —
  latency risk accepted and mitigated by model choice.

Out of scope: Yjs/Hocuspocus collaboration, arbitrary-JSX component runtime,
embedded terminal dock, semantic search, version history, MCP/external
harnesses, i18n.

### Licensing constraints (hard)

- **open-knowledge is GPL-3.0-or-later.** Copy architecture, package
  boundaries, tool verbs, index shapes — never code. inteligir is MIT.
- **Potion is Plate Plus commercial.** Usable in the product under the held
  license (open-source End Products are explicitly permitted), but
  Potion-derived files can't be plainly MIT-relicensed; keep the license
  notice with substantial ports.

---

## 2. Why this is tractable — the Bridge seam

Unchanged from v1: the renderer is already a pure browser React app reaching
node only through `window.desktopBridge`, whose shape derives from the
transport-agnostic `IPC` registry now living in `@repo/core`
(`packages/core/src/ipc-registry.ts`, merged in #351). A WebSocket server
folds the same registry into WS request/response and satisfies the identical
`Bridge` type.

```
                    ┌───────────────── packages/core ─────────────────┐
                    │  IPC registry (Bridge contract) + domain schemas │
                    │  + pure logic (markdown-doc, find-task-line, …)  │
                    └──────────────────────┬──────────────────────────┘
                                           │ implemented-by / typed-by
        ┌──────── packages/app (greenfield Plate UI: Potion kits + Fluid) ────────┐
        │            consumes an injected `Bridge` — no host imports              │
        └───────┬───────────────────────────────────────────────┬────────────────┘
                │ Bridge over Electron IPC        Bridge over WebSocket │
        ┌───────┴────────┐                             ┌───────────────┴────────┐
        │ packages/desktop│  ── both wrap ──▶ packages/host ◀── both wrap ──     │ packages/server
        │ (Electron shell)│   (vault, pi sessions, delegation, executor,        │ (HTTP+WS, serves app)
        └────────────────┘    voice, search/link index)                          └────────┬────────┘
                                                                          packages/cli ── npx launcher
```

---

## 3. Target package graph

> **Layout note (2026-07):** the shippable artifacts later moved to `apps/` —
> `packages/desktop` → `apps/desktop`, `packages/cli` → `apps/cli`
> (apps/ = shippable artifacts, packages/ = libraries). Package names are
> unchanged; paths in this document reflect the layout at the time of writing.

| Package            | Contents                                                                                                                                                                                             | Comes from                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/core`    | **Merged (#351).** Bridge/IPC registry, domain schemas, agent-event parser, pure helpers. Grows: MDX/markdown pipeline types, link-index schemas, doc-update channel.                                | old desktop shell `src/shared/*` (done)                                                     |
| `packages/app`     | **Greenfield.** Portable Plate UI: Potion-kit editor (trimmed to the locked vocabulary), workspace (sidebar, tabs, BottomComposer, palette, settings, voice UI, graph). Fluid-styled. Vite → static. | New, porting `renderer/editor` brains (`markdown-doc` consumers, inline-AI, voice pipeline) |
| `packages/host`    | Node backend as a platform-agnostic library: `VaultManager`, pi sessions, delegation, executor, voice models, search/link index, agent extensions.                                                   | old desktop shell `src/main/*` (minus Electron) + `src/agent/*`                             |
| `packages/server`  | HTTP + WS server: serves the `app` build, folds the `IPC` registry over WS, wired to `host`. Loopback-only bind + host-header allowlist (no accounts — local single-user).                           | New                                                                                         |
| `packages/cli`     | `npx inteligir`: pick/init vault, boot `server`, open browser.                                                                                                                                       | New                                                                                         |
| `packages/desktop` | Thin Electron shell: window/menu/updater, IPC transport over `host`, loads the `app` build. Native voice packaging.                                                                                  | old desktop shell main/preload, slimmed (now `apps/desktop`)                                |
| `apps/web`         | Marketing → grows into docs site later.                                                                                                                                                              | Existing                                                                                    |

Cut from v1: `packages/plugin` (external-harness AI — deferred).

---

## 4. Phased sequencing

Gates stay `pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build`
per PR, but unlike v1 the **desktop app does not track every phase** — it stays
working-but-frozen on `main` until the Phase 5 cutover.

- **Phase 1 — `packages/core`. ✅ merged (#351).**
- **Phase 2 — `packages/app` (greenfield).** New Vite React package: Potion
  editor kits rebuilt on Plate v53 + Base UI menus + Fluid theme, workspace
  chrome, Bridge injected via context. Runs against a stub/dev Bridge in a
  plain browser. Port `markdown-doc` consumers, inline-AI, voice pipeline,
  composer, delegation UI.
- **Phase 3 — `packages/host`.** Lift the node backend out of Electron
  `main` into a platform-agnostic library (vault, pi, delegation, executor,
  voice, new search/link index).
- **Phase 4 — `packages/server` + `packages/cli`.** WS transport over
  `host`, serves `app`; `npx` boots it. First real target: the browser.
  Voice PCM/TTS over WS lands here.
- **Phase 5 — Electron re-wrap + cutover.** `packages/desktop` becomes the
  thin shell loading the `app` build over the IPC Bridge. Old renderer
  deleted; DMG ships again.
- **Phase 6 — features** (any order, run until done):
  - **MDX vocabulary**: callout, toggle, columns, embeds, date — Plate nodes
    - byte-stable MDX serialization + Raw-mode fallback for unknowns.
  - **Editor AI surface**: AI menu w/ intent classification, copilot
    ghost-text, suggestions mode — on pi sessions.
  - **Wiki-links suite**: links + aliases + transclusion + rename-rewrite +
    autocomplete; backlink index in `host`.
  - **Graph view** + **tabs** (tab store, N editor controllers) +
    **rich content** (mermaid render, KaTeX, PDF viewer).
- **Phase 7 — distribution & docs.** Publish `cli` to npm; electron-updater
  for the DMG; grow `apps/web` into docs.

---

## 5. Invariants to preserve

- **Byte-stable markdown/MDX** — `roundTrip(raw) === raw` gates Rich mode
  for the entire new vocabulary; every new node type lands in both the live
  editor kit and the headless mirror, with round-trip tests.
- **pi runs node-side.** In server mode pi + OAuth live in local `host`.
  Never expose the bridge WS without the loopback/auth gate; hosted
  multi-user is out of scope.
- **Electron-only deps stay in `desktop`/`host`** (`electron-updater`,
  `sherpa-onnx-node`, packaging). The browser gets voice via the Bridge, not
  via native modules.
- **Vault stays clean.** App state in `~/.inteligir`; nothing written into
  the vault beyond the user's own files.
- **Boundary lint.** `core`/`app` never import node built-ins; `agent`
  never imports `main` (carried into `host`).
- **No code copied from open-knowledge** (GPL). Potion ports keep their
  license notice.

---

## 6. Known risks (flagged, accepted)

- **MDX strictness vs existing notes**: legacy files with raw `<` / `{`
  drop to Raw mode until touched. Accepted — user's notes are mostly plain
  markdown; Format is one click.
- **Obsidian interop weakens**: MDX components aren't plain markdown to
  other tools; wiki-links keep partial compatibility. Accepted.
