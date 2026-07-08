# Plan 015: Feature — HTML Apps: render vault `.html` files as sandboxed, agent-buildable views

> **Executor instructions**: Follow this plan step by step. This is a FEATURE
> plan with an investigation gate (Step 0). Run every verification command
> before moving on. On any STOP condition, stop and report. When done, update
> this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cd4bde1b..HEAD -- apps/desktop/src/main packages/features/src/ipc-registry.ts apps/desktop/src/renderer/workspace packages/core/src/markdown`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1 (product direction — "build any view")
- **Effort**: L (two milestones; M2 may split into its own PR)
- **Risk**: MED (new privileged protocol + a second broker surface — security-sensitive)
- **Depends on**: none (builds on merged plans 007/012)
- **Category**: direction (feature)
- **Planned at**: commit `cd4bde1b`, 2026-07-08

## Why this matters

The agent can edit markdown, but a vault is more than prose: "turn this folder
of notes into a table / kanban / bookshelf" needs arbitrary UI. hubble.md
(github.com/bholmesdev/hubble.md) proved the shape: a folder-local `.html`
file rendered as a sandboxed app, with host-injected dependencies (so the
agent writes ONE self-contained file, no build step) and a capability-scoped
broker for reading/patching notes. Our agent is local and already has vault
write access — it can author these apps directly; we only need to render them
safely and hand them a read/patch API.

Design debts hubble already paid (adopt their conclusions, do not re-derive):
per-embed decisions in their ADR-0004/0005 failed (popover clipping, in-realm
trust); the accepted design is ADR-0007 — iframe by `src` (NOT `srcdoc`,
which renders blank in Electron sandboxes), custom protocol, deps injected at
serve time, `sandbox="allow-scripts allow-forms"` with NO `allow-same-origin`.

## Current state (inteligir, at `cd4bde1b`)

- `.html` vault files: `classify()` in `packages/features/src/server/vault/vault.ts`
  marks non-doc files `kind: "other"`; the sidebar renders them via `FileRow`
  (`apps/desktop/src/renderer/sidebar/app-sidebar.tsx`) and opening one goes
  through `useVault().openFile` → the editor tries to read it as a doc. There
  is NO html view surface.
- Electron main: `apps/desktop/src/main/index.ts` — hardened webPreferences
  (contextIsolation, sandbox:true, nodeIntegration off), will-navigate guard
  (plan 007), NO custom protocol registered anywhere (grep `protocol.` under
  `apps/desktop/src/main` → nothing).
- Vault confinement: `VaultManager.resolve()` is realpath-safe (plan 007);
  `readBytes`/`readText`/`writeText` are the confined ops. Reuse — never
  bypass.
- Frontmatter: `@repo/core/markdown` owns the parse pipeline; frontmatter
  parsing exists (frontmatter-kit round-trips it). Investigate the exact
  helper for splitting body vs frontmatter in Step 0.
- IPC: registry pattern per `docs/development.md` (registry entry + handler +
  fixture-bridge line, typecheck-enforced). The broker in this plan does NOT
  go through the renderer Bridge — it is main-process ↔ iframe postMessage —
  but note-open/read paths it needs on the RENDERER side do.
- Embed kit (`editor/kits/embed-kit.tsx`) renders `media_embed` generic
  iframes by URL — url-only by charter; HTML-app embeds (M3) are related but
  the vocabulary treatment of raw `<iframe>` HTML in markdown must be checked
  in Step 0 (raw HTML is outside the MDX vocabulary → Raw mode today).
- Conventions: strict TS (no `any`/`as`/`!`), kebab-case, TypeBox schemas for
  every untrusted input, kit Base+React pairs, byte-pinned fixtures generated
  through the pipeline.

## Commands you will need

| Purpose       | Command                                                                                                     | Expected |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| Real app      | `pnpm dev:desktop` (CDP :9222)                                                                              | boots    |
| Harness       | `pnpm --filter @repo/desktop dev:harness`                                                                   | :5173    |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                                          | pass     |
| Full gate     | `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Suggested executor toolkit

- `agent-browser` skill (drive both harness and Electron; the app-view iframe
  is verifiable over CDP).
- Reference: hubble.md's ADR-0007 text is quoted above — do not fetch the repo.

## Scope

**In scope**:

- NEW `apps/desktop/src/main/vault-app-protocol.ts` (protocol + runtime injection)
- `apps/desktop/src/main/index.ts` (register protocol; wire open-html-app)
- NEW `apps/desktop/resources/html-app-runtime/` (vendored: runtime.js you write, Tailwind browser v4 vendored file, Alpine vendored file, theme css)
- NEW `apps/desktop/src/renderer/workspace/html-app-view.tsx` (+ wiring in `workspace-page.tsx` / `vault-context.tsx` so opening `kind:"other"` `.html` shows it)
- NEW broker host: `apps/desktop/src/main/html-app-broker.ts` (postMessage RPC handler — main-side or preload-side per Step 0 findings)
- `packages/features/src/ipc-registry.ts` + handlers + fixture-bridge ONLY if renderer-side channels are needed (e.g. `readVaultDocSplit` returning body+properties)
- `packages/core/src/markdown/` ONLY the frontmatter split helper if none exists
- Tests for: protocol path confinement, broker validation, frontmatter split
- `plans/README.md`

**Out of scope**:

- Inline embeds in markdown (`<iframe src="./x.html">` inside a note) — that
  is M3, a FOLLOW-UP plan: it needs an MDX-vocabulary decision (raw iframes
  currently force Raw mode) and its own round-trip fixtures. This plan ships
  full-panel HTML Apps only.
- Any bundler/build step for apps — hubble's explicit non-goal; ours too.
- Web/mobile rendering of HTML apps.
- An opt-in/out mechanism for injected deps (canonical set only, v1).
- Sharing/foreign-vault trust model — our vaults are single-user; note the
  same tracked debt hubble carries: if vault SHARING ever ships, revisit.

## Git workflow

- Branch: `kyh/plan-015-html-apps`
- Conventional commits per milestone: `feat(desktop): vault-app:// protocol`, `feat(renderer): html app view`, `feat(desktop): html-app file broker`

## Steps

### Step 0: Investigation gate

Answer and record in your report:

1. Where does opening a `kind:"other"` file currently land? (Trace
   `openFile` in vault-context → editor behavior for a `.html` path.)
2. Does `@repo/core/markdown` export a body/frontmatter split usable
   server-side (the broker needs `read → {body, properties}` and patch-like
   recombine)? Name the functions or note the gap.
3. Electron protocol registration: confirm `protocol.handle` +
   `registerSchemesAsPrivileged` availability in our Electron version and
   that a fetch from inside a sandboxed iframe to the custom scheme works
   (hubble's flags: `standard, secure, supportFetchAPI, corsEnabled`).
4. Sandbox inheritance: verify (small spike) that an iframe with
   `sandbox="allow-scripts"` and NO `allow-same-origin`, loaded via the
   custom protocol inside our renderer, does NOT see `window.desktopBridge`
   (the preload). If it does — STOP, that is the whole security model.

### M1a: The `vault-app://` protocol

In `vault-app-protocol.ts`:

- `registerSchemesAsPrivileged([{ scheme: "vault-app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])`
  before app ready; `protocol.handle("vault-app", handler)` after.
- URL shape: `vault-app://app/<vault-relative-path>?token=<per-open token>`.
  The handler: reject unless a token minted for the CURRENT open app matches
  (tokens are random per app-open, held main-side); resolve the path through
  `VaultManager` (confined read — reuse `readBytes`; never `fs` directly);
  `content-type` by extension; `cache-control: no-store`.
- For `.html` responses ONLY: inject before `</head>`: `<script>` runtime
  (`runtime.js`), `<style type="text/tailwindcss">`-loader script (Tailwind
  browser v4, vendored), theme CSS variables; before `</body>`: Alpine
  (vendored, defer). Tag every injected node `data-inteligir-injected`.
  Non-html assets (images/css/js the app references relatively) are served
  raw — apps may split files, but the canonical form is one file.
- Vendor the dependency files under `apps/desktop/resources/html-app-runtime/`
  imported `?raw` (build-time, no CDN at runtime).

**Verify**: unit test the handler's path confinement (traversal, absolute,
symlink — mirror plan 007's vault tests) and token rejection; `pnpm typecheck`.

### M1b: The runtime + broker

`runtime.js` (vanilla, keep it ~hubble-sized, ≤150 lines): exposes
`window.inteligir.files` with `list()`, `read(path)`, `open(path)`,
`create(path, {body, properties})`, `update(path, patch)`, `remove(path)` —
each a `postMessage` RPC (`inteligir:request` / `inteligir:response`) carrying
a request id + the frame token (`window.name`), 10s timeout; each has a
`safe*` variant returning `{ok, value|error}` instead of throwing. Also post
`inteligir:height` from a ResizeObserver (unused in M1, needed by the M3
embed follow-up — cheap to include now).

Broker host (`html-app-view.tsx` listens on `window`, since the iframe's
parent is the RENDERER): validate `event.source === iframe.contentWindow`
AND token === the iframe's `name`; validate every payload with TypeBox;
map to Bridge calls:

- `list` → `listVault()` filtered to docs
- `read` → doc bytes → split `{path, body, properties}` (frontmatter helper)
- `open` → `useVault().openFile(path)` (navigates the editor)
- `update` → patch-like: merge onto current body/properties, recombine,
  `writeVaultDoc` (omitted keys preserved; `properties: {k: null}` deletes k)
- `create` → fails if exists; `remove` → the existing confirm-dialog, then
  `deleteVaultEntry`.
  All paths are vault-relative doc paths; reject anything `..`/absolute/scheme-
  looking BEFORE it reaches the Bridge (defense in depth — the vault confines
  again underneath).

**Verify**: broker unit tests against a fake Bridge (token mismatch ignored,
patch semantics, null-deletes-property, create-exists error, safe\* shapes).

### M1c: The view

`html-app-view.tsx`: when the open path ends `.html`, `workspace-page`
renders it instead of the editor — an iframe
`sandbox="allow-scripts allow-forms"` (NO allow-same-origin),
`src=vault-app://app/<path>?token=…` (token requested from main over a new
IPC channel `mintHtmlAppToken` — registry + handler + fixture stub). A
header bar shows the file name + "Open as text" (routes to the Raw editor
surface — the file is still just a vault file). External navigation from
inside the iframe is already covered by plan 007's guard; confirm.
Live reload: watch the open `.html` via the existing open-note
vanish/change machinery (`onVaultChanged` broadcast → bump an iframe key)
so the agent editing the app hot-reloads it.
Harness: the fixture bridge can't serve `vault-app://`; in the harness build
the view falls back to a `blob:` URL assembled from the fixture's bytes with
the same runtime injected (keeps the UI drivable in dev:harness; note the
broker works identically — it's parent-window postMessage either way).

**Verify** (agent-browser, REQUIRED):

1. Harness: create `demo.html` (an Alpine counter + `inteligir.files.list()`
   rendered as a `<ul>`) via the fixture vault; open it → renders, counter
   clicks, list shows the sample notes.
2. Electron: write the same demo into a temp vault note folder; open it →
   renders; `window.desktopBridge` is UNDEFINED inside the frame (eval in
   the iframe context via CDP); `files.read()` of a note returns body+
   properties; `files.update()` patch round-trips (re-read shows the change,
   file on disk correct, frontmatter preserved).
3. Editing the `.html` on disk (echo >>) hot-reloads the view.

### M1d: Teach the agent

Append a short section to the agent's vault instructions (find where the
chat agent's system context describes the vault — `resources/agent/AGENTS.md`
or equivalent per Step 0): what an HTML App is, the one-file rule (deps are
injected — never add `<script src>` for Tailwind/Alpine/runtime), and the
`window.inteligir.files` API with the patch semantics. Keep it ≤30 lines —
this is prompt copy; write it like documentation, not marketing.

**Verify**: live chat ask — "build me an html app at apps/notes-table.html
that lists my notes as a table" → agent writes the file → opening it renders.
(pi login available on this machine; if the run flakes, operator-pending.)

### Step final: Gates

`pnpm format:fix` then the full canonical gate.

## Done criteria

- [ ] Opening a vault `.html` file shows the sandboxed app view; "Open as text" still works
- [ ] Inside the frame: `window.desktopBridge` undefined; `window.inteligir.files` works (read/update patch semantics unit- AND live-verified)
- [ ] Protocol handler rejects traversal/symlink/absolute/foreign-token requests (tested)
- [ ] Hot-reload on `.html` change; harness path works via blob fallback
- [ ] No bundler, no CDN fetches at runtime (grep the injected HTML for http)
- [ ] Full gate exits 0; `plans/README.md` updated

## STOP conditions

- Step 0.4 fails (sandboxed iframe can see the preload bridge) — the design is unsound on our Electron version; report.
- `srcdoc`-style shortcuts get tempting because the protocol fights you — do NOT switch to srcdoc (hubble documented it renders blank); report the friction instead.
- The frontmatter split helper doesn't exist in core and writing it requires touching the Plate round-trip rules — report scope before writing it.
- Any broker capability seems to need RAW fs access — the API is markdown-file ops only, full stop; report the use case.

## Maintenance notes

- M3 follow-up (separate plan): inline `<iframe src="./x.html">` embeds inside
  notes — needs the MDX-vocabulary decision (admit relative-src iframes as a
  node vs keep Raw), height sync (runtime already posts it), and byte-pinned
  fixtures.
- The injected-deps set (runtime/Tailwind/Alpine/theme) is the versioned
  contract with every app an agent has ever written — treat additions as
  append-only; removals are breaking.
- If vault sharing/multi-user ever ships, foreign `.html` is untrusted code
  on open: the sandbox already assumes this, but re-audit the broker's
  capability set then (hubble tracks the same debt).
- Reviewer focus: the protocol handler and broker are the new privileged
  surfaces — review them like plan 007's resolve() (path games, token reuse,
  event.source spoofing).
