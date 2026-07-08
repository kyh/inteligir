# ADR 0002: HTML Apps run as sandboxed iframes with host-injected deps and a file broker

Status: accepted (2026-07-08). Implementation: `plans/015-feature-html-apps.md`.
Adopted from hubble.md's ADR-0007, whose superseded predecessors (per-embed
iframes; in-realm Shadow DOM) document the dead ends — we inherit their
conclusions rather than re-deriving them.

## Context

"Turn this folder of notes into a table / kanban / bookshelf" needs
arbitrary UI the markdown vocabulary can't express. Our agent is local and
already writes vault files — it can author a view directly if a vault-local
`.html` file renders as an interactive app. But an HTML file in a synced,
agent-written vault must be treated as **untrusted code that executes on
open**.

## Decision

- A vault `.html` file opens as an **iframe** in the content panel:
  `sandbox="allow-scripts allow-forms"` and **no `allow-same-origin`** —
  opaque origin; the frame cannot reach the preload bridge, parent DOM, or
  storage.
- Loaded by **`src` via a custom privileged protocol** (`vault-app://`,
  token-per-open, path-confined through `VaultManager`) — never `srcdoc`
  (renders blank in Electron sandboxes; hubble issue-tested).
- **Dependencies are injected at serve time** (tiny vanilla runtime,
  Tailwind browser, Alpine, theme CSS — vendored, no CDN). Authored apps are
  ONE self-contained file; no bundler, no `node_modules`, ever. The injected
  set is a versioned contract: additions append-only, removals breaking.
- Vault access goes ONLY through a **capability-scoped async broker**:
  `window.inteligir.files.{list,read,open,create,update,remove}` over
  token-authenticated postMessage. These are **markdown-file operations,
  not filesystem access**: `read` returns `{path, body, properties}`,
  `update` is patch-like (omitted keys preserved, `null` deletes a
  property), `remove` requires user confirmation. Every method has a `safe*`
  non-throwing variant.

## Considered options

- **Render in-realm (Web Component / Shadow DOM)** — CSS isolation without
  JS isolation; foreign code runs with host privileges. Rejected (hubble's
  ADR-0005 retreat).
- **Per-embed iframes for inline placements** — popover clipping and
  nested-iframe composition are fatal for inline editor UI (hubble ADR-0004
  retreat). Inline embeds are a follow-up with the trust boundary at the
  document level.
- **A bundler/build step for apps** — kills the "agent writes one file"
  loop. Rejected as a non-goal.

## Consequences

- Apps are viewable as static HTML anywhere, but `window.inteligir` and the
  injected deps only exist when served by the app.
- The protocol handler and broker are privileged surfaces — reviewed like
  vault path confinement (traversal, token replay, `event.source` spoofing).
- Vaults are single-user today; if sharing ever ships, foreign HTML is the
  RCE surface and the broker's capability set must be re-audited first.
- Inline `<iframe src="./x.html">` embeds inside notes are deferred: they
  require an MDX-vocabulary decision (raw iframes currently send a note to
  Raw mode) and height-sync plumbing (the runtime already reports height).
