# Plan 012: Feature — paste/drop images into a note (attachment ingestion)

> **Executor instructions**: Follow this plan step by step. This is a FEATURE
> plan with an investigation gate (Step 0) — its findings can legitimately
> stop the plan for redesign; that is success, not failure. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/features/src/ipc-registry.ts apps/desktop/src/renderer/editor apps/desktop/dev/fixture-bridge.ts packages/features/src/server/handlers`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1 (highest-friction product gap)
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

A notes app where you cannot paste a screenshot is not a daily driver. Today
there is NO way to get image bytes INTO the vault from the editor: the embed
kit is URL-only and its header explicitly scopes uploads out; the chat
composer accepts pasted images but feeds them to the agent, not the vault.
Meanwhile the rename engine ALREADY rewrites `![](assets/…)` references
byte-surgically — the vault model expects assets; only the ingest affordance
and rendering are missing.

## Current state

- `apps/desktop/src/renderer/editor/kits/embed-kit.tsx:1-4` (scope note to honor —
  this plan does NOT touch the embed kit):

  ```
  // Embed kit: url-only media (youtube + video providers via `video`, tweet +
  // generic iframe via `media_embed`, pdf via `file`). Uploads, images, audio,
  // placeholders and captions are all out of scope — inserts must never write
  // `align`/`width`/`isUpload` (bare `src`-only forms are the canonical bytes).
  ```

- There is NO image kit in `apps/desktop/src/renderer/editor/kits/` (22 kits;
  none renders `![](...)` markdown images). What a markdown image currently
  round-trips to is UNKNOWN — Step 0 answers this.

- IPC (`packages/features/src/ipc-registry.ts`): vault channels are doc/text
  only — `readVaultDoc`, `writeVaultDoc`, `deleteVaultEntry`,
  `renameVaultEntry`, `listVault`, `chooseVaultRoot` (~:322-338). No bytes
  channel. Server-side `VaultManager` already has `readBytes`/`writeBytes`
  (used by sync).

- Adding a channel = registry entry (TypeBox payload schema) + handler in
  `packages/features/src/server/handlers/` + one line in
  `apps/desktop/dev/fixture-bridge.ts` (typecheck fails until covered) — this
  is the documented checklist in `docs/development.md`.

- Renderer cannot read vault files directly (sandboxed, Bridge-only). To
  RENDER a vault image the bytes must arrive via a channel (data URL) or a
  custom protocol registered in the Electron main process.

- Editor conventions: every node type is a Base(headless) + React pair in
  `kits/`; Base halves compose in `kits/base-kit.ts` for the serializer
  mirror; `apps/desktop/src/renderer/__tests__/kit-parity.test.ts` enforces
  parity. Round-trip fixtures under `src/renderer/__tests__/fixtures/` are
  BYTE-PINNED — generate new fixture bytes through the pipeline itself
  (`roundTrip`), never by hand; oxfmt ignores that directory.

## Commands you will need

| Purpose       | Command                                   | Expected |
| ------------- | ----------------------------------------- | -------- |
| Harness       | `pnpm --filter @repo/desktop dev:harness` | :5173    |
| Desktop tests | `pnpm --filter @repo/desktop test`        | pass     |
| Full gate     | plan 002's canonical gate                 | exit 0   |
| Real app      | `pnpm dev:desktop`                        | boots    |

## Suggested executor toolkit

- `agent-browser` skill for driving the harness/Electron in the verification steps.
- Plate docs for `ImagePlugin`/`BaseImagePlugin` (`@platejs/media`) — the
  package is already a dependency (the embed kit imports from it).

## Scope

**In scope**:

- `packages/features/src/ipc-registry.ts` (+ schemas), one new handler file or
  an addition to the vault handlers in `packages/features/src/server/handlers/`
- `apps/desktop/dev/fixture-bridge.ts`
- NEW `apps/desktop/src/renderer/editor/kits/image-kit.tsx` + node component
  under `editor/nodes/`
- `kits/base-kit.ts` (add the Base half), markdown rules if Step 0 shows they
  are needed (`editor/markdown/`)
- `apps/desktop/src/main/` ONLY if the vault-image protocol (M2, option b) is chosen
- New round-trip fixtures (generated through the pipeline)
- `plans/README.md`

**Out of scope**:

- `embed-kit.tsx` — its URL-only scope note stands; images are a NEW kit.
- Audio/video/file uploads, captions, resize/align attributes — markdown
  canonical form stays `![alt](path)` bare.
- Mobile rendering of assets — follow-up.
- Sync — assets already sync (all file kinds do).

## Git workflow

- Branch: `kyh/plan-012-attachments`
- Conventional commits per milestone: `feat(editor): ...`, `feat(ipc): ...`

## Steps

### Step 0: Investigation gate — what do markdown images do TODAY?

In the dev harness, create a note containing:

```
![alt text](assets/pic.png)
![external](https://example.com/pic.png)
```

Record: does the note open Rich or Raw? If Rich, what does the image
round-trip to (inspect the serialized bytes after a trivial edit — bytes must
be unchanged)? Check `editor/markdown/` and `packages/core/src/markdown/` for
how mdast `image` nodes are treated (grep `"image"` — note the earlier audit
found no image handling in the renderer markdown rules, so they may fall to a
default). **Report the answer in the PR description.** If images currently
force RAW mode or get MANGLED on round-trip, the markdown rules work in M1
grows accordingly — if it looks larger than ~2 days, STOP and report a
revised estimate instead of pushing on.

### M1 — bytes in, canonical markdown out

1. New IPC channel `writeVaultAsset`: payload
   `{ dir: string; baseName: string; bytesBase64: string }` (TypeBox
   `Type.Object`, mirroring existing schema style in the registry), result
   `{ path: string }` — the handler sanitizes `baseName` (strip path
   separators), picks a collision-free name (`pic.png`, `pic-1.png`, ...)
   under `dir` (default `assets/`), decodes base64, calls
   `vault.writeBytes`, returns the final vault-relative path. Handler lives
   with the other vault handlers; fixture-bridge stores bytes in its
   in-memory map (so the harness works end-to-end).
2. Editor paste/drop: a small plugin (inside the new `image-kit.tsx`) handling
   paste events whose clipboard has image items and file-drops of image MIME
   types: read bytes → `writeVaultAsset` → insert an image node
   (`![](<returned path>)` canonical form) at the selection. Non-image
   pastes/drops must fall through untouched (the chat composer's paste
   handling and plain-text paste must be unaffected — the editor and composer
   are separate surfaces, but verify).
3. Round-trip: whatever Step 0 revealed, ensure `![alt](assets/x.png)`
   round-trips byte-exactly through the serializer mirror (Slate↔mdast rules
   in `editor/markdown/`, Base kit in `base-kit.ts`). Add a byte-pinned
   fixture GENERATED through `roundTrip` (follow the existing fixture tests'
   generation pattern exactly).

**Verify**: kit-parity test passes; new fixture test passes; in the harness,
pasting an image inserts a node and the serialized note contains
`![](assets/<name>)`.

### M2 — render the bytes

Choose based on Step 0/M1 experience, in this preference order:
(a) **data-URL read channel**: new `readVaultAsset` channel returning
base64 (cap ~10 MB, reject bigger with a clear error result); the image
component fetches lazily and renders an object URL; fixture-bridge serves
its in-memory bytes. Simple, no main-process work, fine for typical
screenshots. (b) custom `vault-asset://` protocol in the Electron main
process (streams, no base64 bloat) — only if (a) is visibly inadequate
(multi-MB images common). Implement (a) unless you can articulate why not;
record the choice in the PR.
The React image element renders: the bytes when the path resolves inside the
vault, a broken-file placeholder when it doesn't, and external `http(s)` srcs
as plain `<img src>` untouched.

**Verify**: harness — paste an image, see it rendered; reload, still rendered
(bytes persisted through the fixture store). Electron (`pnpm dev:desktop`) —
paste a screenshot into a real vault note: file appears under `assets/`,
image renders, note bytes show `![](assets/…)`.

### M3 — lifecycle glue

1. Rename: renaming an image file in the sidebar already rewrites
   `![](assets/…)` references (rename engine) — add/extend a features-side
   test if one doesn't already cover the md-image form.
2. Delete: deleting a referenced asset → editor shows the broken-file
   placeholder (no crash) — manual check.
3. `pnpm knip` / full gate green.

**Verify**: full canonical gate → exit 0

## Test plan

- Handler test (features): sanitization (`../x` → stripped), collision suffixing, base64 round-trip to disk bytes.
- Round-trip fixture: md-image note, byte-pinned, pipeline-generated.
- Kit-parity: image kit's Base half registered (the existing test enforces it).
- Renderer test (jsdom project from plan 005, if landed): paste handler calls the bridge and inserts a node (bridge faked).

## Done criteria

- [ ] Paste and drag-drop of an image into a Rich note lands bytes in `assets/` and inserts `![](assets/<name>)`
- [ ] The image renders in Rich mode, both harness and Electron
- [ ] Round-trip of md images is byte-exact (fixture-pinned)
- [ ] Non-image paste/drop behavior unchanged; embed kit untouched
- [ ] Full gate exits 0; `plans/README.md` updated (including Step 0's findings)

## STOP conditions

- Step 0 reveals images currently FORCE RAW MODE and fixing the vocabulary/
  round-trip is a serializer-mirror project of its own — report with estimate.
- The IPC payload size (base64 in a TypeBox-validated message) hits an
  Electron IPC limit for a normal screenshot (~5 MB) — report; the protocol
  approach (M2b) then becomes M1's dependency, which reorders the plan.
- Any existing byte-pinned fixture changes bytes.

## Maintenance notes

- Canonical form is BARE `![alt](path)` — resist attribute creep (align/width)
  which the embed-kit note warns writes non-canonical bytes.
- Mobile: `note/[path].tsx` renders GFM — relative image paths will need a
  resolver there someday; deliberately deferred.
- The `writeVaultAsset` sanitization is a security surface (renderer-supplied
  names) — reviewer should test `../`, absolute paths, and unicode names.
