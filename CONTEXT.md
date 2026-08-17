# CONTEXT.md — the domain glossary

What the words mean. `CLAUDE.md` § Decisions records **why a choice was made**;
this records **what a term names**, where it lives, and — the part worth
reading — the neighbouring concept it gets confused with.

Rules for this file: every entry points at the module that OWNS the concept
rather than restating its implementation, because the module's own header is the
detail and this is the map. An entry that cannot be checked against code does
not belong here.

---

**doc** — a file whose extension is editable text: `.md`, `.markdown`, `.mdx`,
`.txt` (`@repo/notes/knowledge/doc-file`, the single source of that answer).
"Doc" is a CLASSIFICATION, not a shape: it decides what the index projects and
what a rename rewrites links in.

**note** — a doc as a user and the knowledge surfaces address it: the filename
IS the title, there is no slug layer (`@repo/notes/knowledge/note-name`).

**line** — a line's content EXCLUDES its terminator, whichever flavor
(`\r\n`, `\r`, `\n`). That rule is stated once, in
`@repo/notes/knowledge/source-lines`, and it has **two readings that must name
identical bytes**: `splitLines` reads lines as VALUES, `lineSpan` reads one as a
POSITION. The split cannot be used to write — joining back would rewrite every
terminator in the file, so a CRLF doc saved after ticking one box would come
back with every line changed. So a guarded write scans EOLs in place and splices
inside the span. Their agreement is pinned by that module's own test; a third
reading of "what a line is" anywhere else is a file-corruption bug waiting to
happen.

**task ordinal** — a checkbox in a markdown file has no id, so everything that
points at one points at its POSITION among the file's GFM task items, in
document pre-order, checked items included. `(sourceFile, ordinal)` is the
anchor. `@repo/notes/knowledge/task-ordinal` owns the count and every question
asked of it. **Two callers, two state rules, one count**: `openTaskAtOrdinal`
refuses an already-checked item, `toggleTaskAtOrdinal` takes either state. They
may disagree about permission and never about which item. An ordinal is not a
line number and not an offset — lines shifting above it relocate the item,
which is the whole point; the raw-byte guard is what catches the item itself
changing. The count is over `@repo/notes/markdown/scan-parse`'s grammar, which
disables `codeIndented` and `htmlFlow`.

**projection** — what ONE parse of a doc yields: title, headings, links, tags,
aliases, tasks (`@repo/notes/knowledge/projection`, `projectDoc`). An index
stores projections, not documents.

**opaque node** — what the parse pipeline does with a construct an editor
cannot model (raw HTML, a `{…}` expression, unknown JSX):
`@repo/notes/markdown/remark-opaque` replaces it at parse time with a node
holding that construct's markdown as a STRING, rendered as inert literal text
and emitted back unescaped. It is what lets a rich surface open anything that
PARSES, reserving a raw fallback for genuinely malformed input alone. The value
is RE-SERIALIZED from the node, never sliced out of the source — a slice inside
a blockquote captures the `> ` markers the stringifier then adds again.

**private note** — `private: true` in frontmatter (`notePrivacy` in
`@repo/notes/markdown/frontmatter`): only a boolean `true` is private, and a
frontmatter block that cannot be typed is `indeterminate` — AI paths treat that
as private (fail-closed) while a UI shows no lock. It is a flag readers honor,
not an enforcement mechanism.
