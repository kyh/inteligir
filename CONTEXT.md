# inteligir context

Glossary for shared terms across the project. Implementation detail belongs
in code, `CLAUDE.md` (architecture), or `docs/adr/` (decisions) — not here.
Use these words in code, comments, specs, and prompts; the _Avoid_ lines are
the synonyms that have caused confusion.

## Flagged ambiguities

- **"Vault changed" ≠ "the watcher fired."** `onVaultChanged` is the
  renderer-facing event meaning "re-read your view of the vault." Its
  SOURCES are app-initiated writes, the open-note watcher, focus/manual
  refresh, and delegation completion (see ADR-0001) — not a recursive
  filesystem watcher.
- **"Open" is overloaded.** In the renderer, opening a note replaces the
  single document surface (no tabs — a product decision). In the HTML App
  File API, `open(path)` means "navigate the editor," never an OS-level open.
- **"Assets" today = the flat `assets/` folder** used by image paste
  (plan 012). Any future per-note asset convention is a migration, not a
  synonym.

## Glossary

### Vault

The user-chosen folder of markdown files that IS the user's content. Files
are canonical; the app never quarantines or shadow-copies them. App state
lives in `~/.inteligir`, never in the vault.
_Avoid_: workspace (that word belongs to the AGENT's working dir).

### Note

A markdown file in the Vault (`.md`). Markdown with the fixed MDX
vocabulary; anything outside the vocabulary opens in Raw mode instead of
being normalized.

### Raw mode

The byte-exact textarea surface for files the Rich editor cannot represent
without changing bytes. Raw is a safety hatch, not a second editor.

### Kit

One editor node type as a Base (headless) + React pair under `editor/kits/`.
Base halves compose into the serializer mirror; kit-parity tests enforce the
pairing.

### Bridge

The injected, transport-agnostic API the renderer talks to — derived from
the IPC registry. The renderer never imports electron/node; the dev harness
substitutes an in-memory fixture Bridge.

### Knowledge index

The derived, per-device indexes (links, backlinks, lexical search, wiki
targets) built by `@repo/core/knowledge` over the Vault. Rebuilt locally,
NEVER synced.

### Delegation

A checkbox task handed to the background agent: snapshot first, agent edits
via its workspace symlink, result appended, restorable byte-exactly from the
snapshot.

### Agent workspace

The pi agent's working directory containing the `./vault` symlink. The agent
reaches notes through it with native file tools; capabilities that are not
plain file access arrive as ports (`AgentPorts`).

### Sync base

The last-synced manifest anchor the 3-way reconcile diffs against. A PURE
CACHE: missing/corrupt/legacy means "re-sync from empty," never data loss.

### Conflict copy

The losing side of a sync conflict, preserved as a sibling file named by
`conflictCopyName` (core owns the name AND the reverse matcher). Surfaced in
Settings → Sync; dismissing deletes the COPY, never the note.

### HTML App

A vault-local `.html` file rendered as a sandboxed interactive view (opaque
origin, host-injected dependencies). It reaches notes ONLY through the
capability-scoped async broker (`window.inteligir.files`), never the Bridge
or the filesystem. See ADR-0002.

### File Properties

Typed fields parsed from a Note's YAML frontmatter. The file is the only
store — no metadata database. Unsupported or invalid YAML is preserved
byte-exactly, never coerced.
