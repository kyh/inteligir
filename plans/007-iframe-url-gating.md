# Plan 007: Gate note-authored iframe URLs to http(s) and sandbox the PDF viewer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index (or the index does not exist yet, in which case skip it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/desktop/src/renderer/editor/nodes packages/features/src/ipc.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

Two editor nodes drop a **note-authored URL straight into an `<iframe src>`**
with no scheme check, and one of them has **no `sandbox` attribute at all**.
Note content is not trusted input: the agent writes notes, and a delegated
background agent writes notes from whatever it read on the web. Today a note
containing `<file src="https://evil.example/x.pdf" />` loads an **un-sandboxed,
scripted, cross-origin page inside the product window** — the `.pdf` test is on
the URL _string_, and any server can serve HTML+JS at a URL ending in `.pdf`.

Scope the severity honestly: the frame is cross-origin, so the same-origin
policy still shields the renderer's `window.desktopBridge`. This is **not**
renderer takeover. What it _is_: an un-sandboxed foothold for tracking and
exfiltration beacons, popups, and user-gesture top-level navigation — i.e.
phishing rendered inside the app's own chrome, which users read as trusted.
`embed-node` is the same class of hole one notch lower (it _is_ sandboxed
without `allow-same-origin`, so it gets an opaque origin), but it still
auto-loads arbitrary external scripted content on render, and it too accepts any
scheme.

After this lands: a note can only ever point an iframe at `http(s)`, and the PDF
path is either sandboxed or replaced with a link-out — no un-sandboxed frame
remains anywhere in the editor.

## Current state

### File 1 — `apps/desktop/src/renderer/editor/nodes/pdf-node.tsx` (the whole file is 59 lines; this is the relevant part, lines 15-39, verbatim)

```tsx
const PDF_RE = /\.pdf(?:[?#]|$)/i;

export function FileElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const url = typeof props.element.url === "string" ? props.element.url : "";
  const name = typeof props.element.name === "string" ? props.element.name : null;

  return (
    <PlateElement {...props} className="py-2.5">
      <figure className="group/media relative m-0 w-full" contentEditable={false}>
        {PDF_RE.test(url) ? (
          // No sandbox attr: the browser-native PDF viewer (a plugin document)
          // refuses to render inside a sandboxed frame — sandboxing here shows
          // a blank pane, which defeats the embed. The frame only ever hosts
          // the URL the note author wrote, same trust as clicking the link.
          // oxlint-disable-next-line react/iframe-missing-sandbox
          <iframe
            className={cn(
              "h-[70vh] w-full rounded-md border border-border",
              focused && selected && "ring-2 ring-ring ring-offset-2",
            )}
            src={url}
            title={name ?? "PDF document"}
          />
        ) : (
```

Lines 40-53 are the non-PDF fallback — an `<a target="_blank" rel="noopener noreferrer">`
link card with a `FileTextIcon`. **That branch already exists**; the fix reuses it.

The comment's premise — "The frame only ever hosts the URL the note author
wrote, same trust as clicking the link" — is the bug. Clicking a link opens the
system browser (see below); an iframe runs the page _inside the app_, and the
two are not the same trust at all.

### File 2 — `apps/desktop/src/renderer/editor/nodes/embed-node.tsx` (lines 19-62, verbatim, abridged to the iframe branch)

```tsx
export function MediaEmbedElement(props: PlateElementProps) {
  const selected = useSelected();
  const focused = useFocused();
  const dark = useDarkClass();
  const url = typeof props.element.url === "string" ? props.element.url : "";
  const tweet = parseTwitterUrl(url);
```

…and the non-tweet branch, `embed-node.tsx:48-62`:

```tsx
        ) : url ? (
          <iframe
            className={cn(
              "aspect-video w-full rounded-md border border-border",
              focused && selected && "ring-2 ring-ring ring-offset-2",
            )}
            sandbox="allow-scripts allow-popups allow-presentation"
            src={url}
            title="Embed"
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Embed: no URL
          </div>
        )}
```

Note the third branch ("Embed: no URL") — the fix reuses it as the rejection
fallback.

### The helper that already exists (REUSE IT — do not write a second URL parser)

`packages/features/src/ipc.ts:30-37`:

```ts
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
```

The renderer is already allowed to import it and already does — see
`apps/desktop/src/renderer/settings/extensions/add-custom-connector-dialog.tsx:26`:

```ts
import { isHttpUrl } from "@repo/features/ipc";
```

It is also the exact guard the main process uses before handing a URL to
`shell.openExternal` (`apps/desktop/src/main/index.ts:229-234`) and the guard the
executor handler uses (`packages/features/src/server/handlers/executor-handlers.ts:47`).
Using it here makes the editor's gate identical to the app's existing
trust boundary. **Do not hand-roll a regex scheme sniffer.**

### The safe pattern already in the codebase (contrast — read it, don't change it)

`apps/desktop/src/renderer/editor/nodes/youtube-node.tsx:36-68` never passes the
note's URL to the iframe at all: it runs `parseVideoUrl(url)` from
`@platejs/media` and puts the **provider-derived** `embed.url` in the `src`.
That's an allowlist. `pdf-node` and `embed-node` are the two that pass raw note
content through.

### The external-link path (used by option B in Step 3)

The renderer never calls `shell` directly. An `<a target="_blank">` click is
caught by the main process's window-open handler, which allows only http(s) and
routes it to the system browser — `apps/desktop/src/main/index.ts:229-234`:

```ts
window.webContents.setWindowOpenHandler((details) => {
  if (isHttpUrl(details.url)) {
    void shell.openExternal(details.url);
  }
  return { action: "deny" };
});
```

So "render a link card instead of a frame" needs **no new plumbing** — the
existing `<a href target="_blank" rel="noopener noreferrer">` in `pdf-node`'s
else-branch already lands in `shell.openExternal`.

### Repo conventions that apply

- Kebab-case filenames (`safe-url.ts`), no barrel files (direct subpath imports).
- **No `any`, no non-null `!`, no `as` casts.**
- Renderer code is host-agnostic: it may import `@repo/ui/*` and
  `@repo/features/ipc`, but never `electron`/`node` (lint-enforced).
- Path alias: renderer files import each other as `@renderer/...` (see
  `pdf-node.tsx:13`: `import { MediaToolbar } from "@renderer/editor/nodes/media-toolbar";`).
- Conventional commits; branch prefix `kyh/`.

## Commands you will need

| Purpose       | Command                                                                              | Expected on success |
| ------------- | ------------------------------------------------------------------------------------ | ------------------- |
| Install       | `pnpm install`                                                                       | exit 0              |
| Format        | `pnpm format:fix` (run FIRST, never after gates)                                     | exit 0              |
| Typecheck     | `pnpm typecheck`                                                                     | exit 0, no errors   |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                   | all pass            |
| Lint          | `pnpm lint`                                                                          | exit 0              |
| Full gates    | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0              |

## Scope

**In scope** (the only files you should modify/create):

- `apps/desktop/src/renderer/editor/nodes/safe-url.ts` (**create**)
- `apps/desktop/src/renderer/editor/nodes/pdf-node.tsx`
- `apps/desktop/src/renderer/editor/nodes/embed-node.tsx`
- `apps/desktop/src/renderer/__tests__/safe-url.test.ts` (**create**)

**Out of scope** (do NOT touch, even though they look related):

- **The markdown round-trip / serialization.** This is a **RENDER-time gate
  only**. The canonical bytes of `<file src="…" />` and `<media_embed src="…" />`
  must not change: a note with a `javascript:` URL still round-trips those exact
  bytes; it just doesn't get a frame. **The byte-pinned fixtures under
  `apps/desktop/src/renderer/__tests__/fixtures/` MUST stay byte-identical — never
  hand-edit them, never run a formatter over them** (oxfmt already ignores that
  tree; formatting the fixtures is corruption).
- `apps/desktop/src/renderer/editor/nodes/youtube-node.tsx` — already
  allowlisted via `parseVideoUrl`; leave it.
- `apps/desktop/src/renderer/editor/nodes/image-node.tsx` and the `assets/`
  image path — `<img>` is not a script/navigation surface; different problem.
- `apps/desktop/src/renderer/editor/kits/*` and `base-kit.ts` — the Base
  (headless) halves are serialization-only and never render an iframe. Kit-parity
  tests must keep passing untouched.
- The `vault-app://` HTML-app sandbox (`workspace/html-app-runtime.tsx` and the
  protocol handler) — a separately designed capability boundary. Not this plan.
- `packages/features/src/ipc.ts` — reuse `isHttpUrl`, do not modify it.

## Git workflow

- Branch: `kyh/plan-007-iframe-url-gating`
- Conventional commits, e.g.
  `fix(desktop): gate note-authored iframe URLs to http(s)`
- Do NOT push and do NOT open a PR.

## Steps

### Step 1: Add the shared scheme guard

Create `apps/desktop/src/renderer/editor/nodes/safe-url.ts`:

```ts
// A note's URL is UNTRUSTED input: the agent writes notes, and a delegated
// background agent writes them from whatever it read on the web. Any URL that
// reaches an `<iframe src>` must therefore be gated to http(s) first —
// `javascript:`, `data:`, `file:` and vault-relative paths all have no business
// in a frame. Nodes that can't render a URL fall back to their existing
// non-iframe branch (a link card / a placeholder) rather than framing it.
//
// Reuses the app's ONE scheme predicate (`isHttpUrl`) — the same guard the main
// process applies before `shell.openExternal` — so the editor's trust boundary
// can't drift from the rest of the app's.

import { isHttpUrl } from "@repo/features/ipc";

/** The url when it is a well-formed http(s) URL, else null. */
export function safeFrameUrl(url: string): string | null {
  return isHttpUrl(url) ? url : null;
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Gate `embed-node.tsx` (the simple one — do it first)

In `apps/desktop/src/renderer/editor/nodes/embed-node.tsx`:

1. Import the guard: `import { safeFrameUrl } from "@renderer/editor/nodes/safe-url";`
2. After `const tweet = parseTwitterUrl(url);`, add
   `const frameUrl = safeFrameUrl(url);`
3. Change the non-tweet branch condition from `) : url ? (` to
   `) : frameUrl !== null ? (` and the iframe's `src={url}` to `src={frameUrl}`.
   A rejected URL therefore falls through to the **existing** "Embed: no URL"
   placeholder branch. Change that placeholder's copy so it isn't a lie for the
   new case — e.g. render `Embed: no URL` when `url` is empty and
   `Embed: unsupported URL` when `url` is non-empty but rejected. Keep it to the
   same `<div>` shell and Tailwind classes; do not restyle.
4. **Drop `allow-popups`** from the sandbox, leaving
   `sandbox="allow-scripts allow-presentation"`. A note-authored frame that can
   spawn popups is a phishing surface, and nothing in the repo cites an embed
   that needs it. Before you do this, confirm nothing depends on popups:

```bash
grep -rn "allow-popups" apps packages --include='*.ts' --include='*.tsx' --include='*.md' | grep -v node_modules
```

Expected: matches only in `embed-node.tsx` and `youtube-node.tsx` (and this
plan file). **If any test or fixture asserts on `allow-popups`, STOP and
report.** (`youtube-node.tsx` is out of scope — leave its sandbox alone; its
URL is provider-derived, not note-authored.) 5. Update the file's header comment (lines 3-6) so it states that non-tweet
embeds are gated to http(s) and sandboxed without `allow-same-origin`.

**Verify**:

- `pnpm typecheck` → exit 0.
- `grep -n "sandbox=" apps/desktop/src/renderer/editor/nodes/embed-node.tsx` →
  exactly one match, reading `sandbox="allow-scripts allow-presentation"`.
- `pnpm --filter @repo/desktop test` → all pass (the round-trip / kit-parity
  suites must be untouched — they test bytes, not render).

### Step 3: Fix `pdf-node.tsx` — pick option A or option B, then gate the URL either way

The un-sandboxed iframe must go. There are exactly two acceptable end states.
**Read both, choose one, and state which you chose (and why) in your final
report.**

**Option A — sandboxed JS viewer.** Render the PDF through a sandboxed frame
using a JS-based viewer (pdf.js-style), i.e. `sandbox="allow-scripts"` on a
frame whose document is our own viewer page, with the note's URL passed to it as
data — never a frame pointed straight at the remote document. This preserves
inline PDF viewing.
**Cost**: it needs a PDF-rendering dependency and a local viewer asset.
**→ If option A requires adding a dependency to `package.json`, STOP and report
before installing anything.** Dependency additions are the operator's call, not
the executor's. Do not `pnpm add` on your own initiative.

**Option B — link card (no frame).** Delete the iframe branch entirely: every
`file` node — PDF or not — renders the existing `<a>` link card
(`pdf-node.tsx:40-53`). A click leaves the app through the main process's
window-open handler → `shell.openExternal` → the system browser's PDF viewer,
which is sandboxed by the OS and by the browser. Zero new deps, zero remaining
frames, and it deletes `PDF_RE` and the `oxlint-disable` line with it.
**Cost**: PDFs no longer preview inline in the editor; the user gets a click-out.
**This is the default choice** — it is strictly safer, it is smaller, and it can
be upgraded to option A later without any format change (the canonical bytes are
unchanged either way).

Whichever option you choose, the URL gate is mandatory:

- Import `safeFrameUrl` and compute `const frameUrl = safeFrameUrl(url);`.
- Any branch that would put a URL in an `<iframe src>` must use `frameUrl` and
  must not render when it is `null`.
- The `<a>` link card's `href={url || undefined}` must ALSO be gated — a
  `javascript:` href in an anchor is its own (smaller) hole. Use
  `href={frameUrl ?? undefined}`; when it is null, render the same card without
  an `href` (a non-clickable row showing the raw text) so the user still sees
  that the note references a file. Keep `target="_blank" rel="noopener noreferrer"`.
- If you take option B, delete `PDF_RE`, the `// oxlint-disable-next-line
react/iframe-missing-sandbox` comment, and the stale justification comment
  (`pdf-node.tsx:27-30`) — leaving a disable-comment for a rule nothing violates
  is exactly the kind of stale license that grows back into a hole.
- Rewrite the file header (`pdf-node.tsx:1-6`) to describe the new behavior.

**Verify**:

- `pnpm typecheck` → exit 0.
- `grep -rn "iframe-missing-sandbox" apps/desktop/src` → **no matches** (option
  B), or exactly the intended sandboxed-frame code (option A).
- `grep -rn "<iframe" apps/desktop/src/renderer/editor/nodes/` → every remaining
  match has a `sandbox=` attribute on it. Confirm by reading each hit.
- `pnpm --filter @repo/desktop test` → all pass.

### Step 4: Tests

See the Test plan below.

**Verify**: `pnpm --filter @repo/desktop test` → all pass, including the new
`safe-url.test.ts` cases.

### Step 5: Confirm the fixtures did not move

```bash
git status --porcelain apps/desktop/src/renderer/__tests__/fixtures/
```

**Verify**: **empty output.** A single modified fixture means something
serialized differently — that is a STOP condition, not something to "fix" by
re-pinning the fixture.

### Step 6: Gates

```bash
pnpm format:fix   # FIRST — never after gates
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
```

**Verify**: every command exits 0.

## Test plan

**Honest note on the level of testing, and why.** The repo has only four
component-mounting tests repo-wide
(`apps/desktop/src/renderer/settings/settings-panel.test.tsx`,
`workspace/html-app-runtime.test.tsx`, `components/confirm-dialog.test.tsx`,
`editor/markdown-editor.test.tsx`); there is **no Plate-element mounting
harness**, and standing one up for a two-line branch guard is not a good trade.
So: unit-test the guard exhaustively, and verify the two nodes' branching by
**reading** the diff (the greps in Steps 2, 3 and 5 make that mechanical). Do
**not** invent a mounting harness for this plan; if you find yourself building
test infrastructure, you have left the scope.

New file `apps/desktop/src/renderer/__tests__/safe-url.test.ts` (plain vitest,
no DOM needed — model the file shape on any existing pure test in that dir, e.g.
`tree-navigation.test.ts`):

`safeFrameUrl` returns the url unchanged for:

- `"https://example.com/doc.pdf"`
- `"http://example.com/embed"`
- an http(s) URL with a query and fragment (`"https://example.com/x.pdf?a=1#p2"`)

`safeFrameUrl` returns `null` for:

- `"javascript:alert(1)"` — the classic
- `"JavaScript:alert(1)"` — case-insensitivity of the scheme is handled by
  `new URL()`, pin it
- `"data:text/html,<script>alert(1)</script>"`
- `"file:///etc/passwd"`
- `"vault-app://token/x.pdf"` — the app's own protocol has no business in a note
  frame
- `"assets/report.pdf"` — a vault-relative path (unparseable as an absolute URL)
- `"notes/../../etc/passwd"` — traversal-shaped relative path
- `""` — the empty string the nodes produce when `element.url` isn't a string
- `"   "` — whitespace

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @repo/desktop test` exits 0, including the new
      `safe-url.test.ts`
- [ ] `grep -rn "iframe-missing-sandbox" apps/desktop/src` returns no matches
      (option B), or the sole match is the intentionally sandboxed viewer frame
      (option A)
- [ ] Every `<iframe` under `apps/desktop/src/renderer/editor/nodes/` carries a
      `sandbox=` attribute (`grep -rn -A6 "<iframe" apps/desktop/src/renderer/editor/nodes/`)
- [ ] `grep -n "allow-popups" apps/desktop/src/renderer/editor/nodes/embed-node.tsx`
      returns no matches
- [ ] `git status --porcelain apps/desktop/src/renderer/__tests__/fixtures/` is
      empty (no fixture byte moved)
- [ ] `git diff --stat` shows no `package.json` change (no dependency added
      without operator sign-off)
- [ ] `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` all exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (if that index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- **Option A would add a dependency.** Do not run `pnpm add`. Report the
  candidate package and its size, and take option B in the meantime — or stop
  and wait, if the operator's preference is unclear.
- **Any byte-pinned fixture under `apps/desktop/src/renderer/__tests__/fixtures/`
  changes.** This plan touches render only; a fixture moving means you edited a
  serialization path. Revert and report. Never re-pin a fixture to make a test
  green.
- A round-trip, kit-parity, or markdown test fails. Same reason: this change must
  be invisible to the serializer.
- `grep` finds a test/fixture that asserts on `allow-popups` or on the absence of
  a `sandbox` attribute — something depends on the current behavior; report
  before changing it.
- The excerpts in "Current state" don't match the live code (drift).
- You find yourself wanting to change `@platejs/media`'s parsing, the
  `vault-app://` protocol, or the kits — all out of scope; report instead.

## Maintenance notes

For the human/agent who owns this after the change lands:

- **The rule to hold going forward: a URL that came out of note content NEVER
  reaches an `<iframe src>` un-gated and un-sandboxed.** `youtube-node.tsx` is
  the pattern to copy when a new embed node is added — derive the frame URL from
  a provider parser (an allowlist), don't pass the author's string through.
- `safeFrameUrl` intentionally gates on _scheme only_, not host. A host allowlist
  would break the point of embeds. If exfiltration-by-embed ever becomes a real
  concern (e.g. shared vaults, where a foreign note is untrusted code), the next
  lever is a CSP `frame-src` on the renderer plus a per-embed "click to load"
  gate — deliberately NOT built here, because with single-user vaults the note
  author is the user.
- If option B was taken and someone later wants inline PDFs back, option A is the
  upgrade path and requires **no format change** — the canonical byte-form
  `<file src="…" />` is untouched by either option.
- What a reviewer should scrutinize: (a) that the `<a href>` in `pdf-node` is
  gated too, not just the iframe; (b) that the rejected-URL branch still _shows_
  the user something (a silent empty render is a worse bug than a link card);
  (c) that the `oxlint-disable` comment is gone rather than merely relocated.
