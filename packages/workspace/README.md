# @repo/workspace

The product UI. Everything a signed-in user sees at `/app`, over an injected
Bridge and nothing else.

## Why it exists

The workspace is host-agnostic by PACKAGE FACT rather than by lint rule: its
deps are `@repo/bridge`, `@repo/editor`, `@repo/notes` and `@repo/ui`, so there
is no host module to import even by accident. `App` renders once
`@repo/bridge/client::installBridge` has run; the app that mounts it supplies a
transport and an HTML-app runtime, and that is the whole contract.

## Layout

```
src/
  app-root.tsx         # App: providers, and the switch between the two surfaces
  onboarding/
    onboarding-page.tsx # the pre-ready surface (starting / setting_up), with Retry
  workspace/
    workspace-page.tsx # the ready surface: sidebar | editor | bottom composer
    vault-context.tsx  # the cadence-split VaultProvider (see Invariants)
    connections-panel.tsx, graph-view.tsx, tasks-view.tsx
                       # backlinks under the editor; the two lazy alt surfaces
    status-bar.tsx, document-stats.ts, scroll-fade.tsx
                       # the bottom status row (save dot, private/Raw, the
                       # toggleable counts) and the document's bottom fade
    use-nav-history.ts # Back / Forward over the notes this session opened
    agent-edit-undo.ts, use-agent-confirm.ts, use-deep-link.ts,
    capture-apply.ts, use-note-templates.ts
                       # the post-turn undo, the destructive-tier prompt,
                       # inteligir:// nav, capture into the live buffer,
                       # templates + the daily note
  sidebar/             # the VS Code-style file tree + roving-tabindex nav
  composer/            # the pinned chat: input, bubbles, past threads,
                       # and the connect-a-provider row
  command/             # the palette — search, tag: narrowing, every command
  delegation/          # the delegation dock
  appearance/          # the typed appearance record + the ONE funnel that
                       # turns it into CSS custom properties
  settings/            # the settings SURFACE and its sections
  voice/               # dictation + read-aloud + the narration wiring
  stores/              # agent (chat), ui-state, view, voice
  ai-elements/         # the chat message primitives
  components/          # app-wide chrome app-root mounts: error boundary,
                       # reauth dialog, theme toggle, the orb
  layout/header.tsx    # sidebar toggle, Back/Forward, breadcrumb, one menu
  lib/                 # use-disk-state (ui-state through the Bridge) +
                       # use-theme (the workspace's own ThemeProvider binding)
  styles/globals.css   # the app's Tailwind entry over @repo/ui/globals.css
  dev/
    fixture-bridge.ts  # the in-memory Bridge the suites mount against
    wasm-sql-driver.ts # SQLite wasm behind it, so the REAL knowledge engine runs
```

## Invariants

- **The Bridge is the only way out.** "No host import" is ENFORCED — a package
  fact (`@repo/web` is not a dep) that `tools/repo-guards`' dep-DAG suite pins.
  "No fetch, no transport of its own" is CONVENTION: nothing lints for it, and
  it holds today (zero `fetch(` in `src`). The deliberate exceptions live in
  `apps/web` — the export URL the account section renders is a same-origin path
  handed in, not a request made here. `getBridge()` throws until a host installs
  one, which enforces install ORDER rather than exclusivity.
- **`vault-context.tsx`'s three seams are a CONTRACT, not an optimization.**
  Actions have fixed identity so action-only consumers never re-render; the
  listing changes only on a structural refresh; the open note lives in a zustand
  store (`@repo/editor/note/open-note-store`) read through selectors, so a
  keystroke re-renders the editor and nothing else. Do not collapse them, and do
  not let a compiler reason about their memo identities (root `CLAUDE.md`
  § Decisions).
- **ONE Connections panel.** Incoming links collapse under the editor column;
  outgoing links are already on screen in the document and counted in Page
  details, so they are not restated below it.
- **The palette is a hardcoded array**, and stays one (root `CLAUDE.md`
  § Decisions). So are the settings sections.
- **Chrome over the document is the header and the status bar, and they split
  by KIND.** The header carries things to press (the sidebar toggle,
  Back/Forward, one overflow menu holding every per-file action); the status bar
  carries things to read (saved/unsaved, private, Raw, the counts). A control
  that drifts into the status bar, or a badge into the header, is the drift that
  put fifteen affordances over the document in the first place.
- **Appearance is CSS custom properties and nothing else.** Every field of the
  record maps to one property, `applyAppearanceSideEffects` is the only writer,
  and `styles/globals.css` declares the same defaults so the first paint is
  right before the boot bundle lands. A preference with no CSS behind it (which
  counts the status bar shows) gets its own ui-state key instead.
- **The fixture Bridge must DO something.** A new channel's stub either acts on
  the in-memory state or throws `unavailable("<feature>")` naming the gap —
  never a silent `[]`. It is fully typed against the real `Bridge`, so a
  registry change fails typecheck here until it is covered.
- **Nothing serves the fixture as an app.** It is a test fixture; the only way
  to see this UI is the real Worker (`pnpm dev:web`).

## Seams

- `@repo/bridge/client::installBridge` — the transport, installed before the
  first render.
- `workspace/account-host.ts::accountPort` — the account section's email,
  sign-out, export URL and delete. Absent means a surface with no account
  concept, and the section renders nothing rather than an empty box.

## Testing

```bash
pnpm --filter @repo/workspace test
```

Two vitest projects: `workspace` (node, `*.test.ts`) and `workspace-dom`
(jsdom, `*.test.tsx`). The knowledge-facing suites drive the REAL engine through
`dev/wasm-sql-driver.ts`, so a fixture answer is core's answer rather than a
hand-written one.
