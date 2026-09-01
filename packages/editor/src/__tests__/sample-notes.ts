// The corpus tripwire's sample vault: every sample note carries an expected
// canonical/raw class, so a plugin change that silently reclassifies prose is a
// red diff rather than a surprise.

// Single source with the round-trip fixture matrix: the full-vocabulary sample
// note IS the canonical kitchen-sink fixture.
import kitchenSink from "./fixtures/roundtrip/canonical/kitchen-sink.md?raw";

// Exported for the legacy-corpus classification test: every sample note must
// hold its expected canonical/raw class as the pipeline evolves.
export const SAMPLE_NOTES = {
  // Sample notes are PRE-CANONICALIZED (pinned by the corpus test): a churn-y
  // note would reflow wholesale on its first edit, drowning the user's change
  // in formatting noise. Long paragraphs stay on one line (the alternative
  // canonical form is `\`-terminated hard-break lines).
  // empty.md exercises the pristine-editor placeholder path — the one state
  // every other (non-empty) sample note can't reach.
  "empty.md": "",
  "welcome.md": `# Welcome

This is the **inteligir** dev harness — a plain-browser run of the portable app against an in-memory vault. Edits persist until you reload the page.

- Open a note from the sidebar
- Try the editor: headings, lists, tables, code
- The chat composer streams a canned reply

Read more in [tasks](tasks.md).
`,
  "tasks.md": `# Tasks

## Today

- [ ] Review the replatform plan
- [x] Extract the renderer into packages/app
- [ ] Boot the dev harness in a browser

## Later

- [ ] Port the editor to the Potion kits
- [ ] Wire the WebSocket bridge
`,
  "notes/roadmap.md": `# Roadmap

| Phase | Package         | Status |
| ----- | --------------- | ------ |
| 1     | packages/core   | merged |
| 2     | packages/app    | active |
| 3     | packages/host   | queued |
| 4     | packages/server | queued |
`,
  "notes/snippets.md": `# Snippets

A code block to exercise syntax highlighting:

\`\`\`ts
export function greet(name: string): string {
  return \`hello, \${name}\`;
}
\`\`\`

Inline \`code\` and a blockquote:

> Bytes on disk stay canonical.
`,
  // A folder-inside-a-folder so the sidebar tree shows depth-2 nesting and
  // multi-level indent guides.
  "notes/archive/2025-recap.md": `# 2025 recap

A nested archive note exercising deep folders in the sidebar tree.

- Shipped the vault sync engine
- Ported the editor kits
`,
  "journal.md": `# Journal

## 2026-07-01

Opened the workspace. _Everything_ renders from plain markdown.

1. First ordered item
2. Second ordered item
`,
  // WP1 pipeline notes — drive the Rich/Raw gate end-to-end in the harness.
  "kitchen-sink.md": kitchenSink,
  "legacy-web-clip.md": `# Clipped page

<!-- saved from a browser -->

<div align="center">Centered legacy HTML</div>

See <https://example.com/original> for the source. Load {unmatched

Latency is <50ms on a good day.
`,
  "frontmatter-note.md": `---
title: Frontmatter note
published: true
draft: false
priority: 2
due: 2026-07-01
status: on
tags:
  - meta
  - demo
nested:
  keep: me
---

# Frontmatter note

Edit the typed properties above; the yaml block round-trips byte-for-byte.
`,
  // A `private: true` note so the AI-exclusion surfaces are drivable in the
  // harness: no lock-free AI affordances, read-aloud hidden in the palette,
  // and the header lock badge.
  "private-note.md": `---
private: true
---

# Private note

This note is marked private, so every AI surface skips it on this device.
`,
  // Inline-tag note (tags palette): exercises the palette `#` flow. Its inline
  // #meta unifies with frontmatter-note.md's frontmatter `tags: [meta, demo]`,
  // so the tag list demos BOTH sources (meta count 2) and inline-only tags.
  // Pre-canonical prose (the corpus test pins it canonical).
  "tagged.md": `# Tagged note

Inline tags: working on #project and #meta this week, with #ideas to chase.

A nested tag #area/deep-dive lives here too.
`,
  // WP2 vocabulary notes — every kit exercisable in the harness. All four are
  // CANONICAL (the corpus test pins that): editing them must never flip the
  // note to Raw.
  "components-playground.md": `# Components playground

One of each vocabulary block, exercisable in the harness.

<toggle>
  Toggle summary line.

  Toggle body with a [[wiki link]] and **bold**.

  - nested bullet
  - another
</toggle>

<toggle />

<column_group>
  <column>
    Left column text.
  </column>

  <column>
    Right column text.
  </column>
</column_group>

<column_group>
  <column width="33.33%">
    one
  </column>

  <column width="33.33%">
    two
  </column>

  <column width="33.34%">
    three
  </column>
</column_group>

Due <date value="2026-07-04" /> and reviewed on <date value="2026-07-01" />.

<video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />

<video src="https://vimeo.com/76979871" />

<media_embed src="https://twitter.com/jack/status/20" />

<file src="https://pdfobject.com/pdf/sample.pdf" />

<callout variant="info">
  A compat callout with **bold** body text.
</callout>

> [!TIP]
> Product callouts stay GitHub-alert blockquotes.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Inline math $$E = mc^2$$ mid-sentence, and an emoji trigger to try: type a colon.
`,
  "math-and-diagrams.md": `# Math and diagrams

Display math with a multi-line matrix:

$$
\\begin{pmatrix}
a & b \\\\
c & d
\\end{pmatrix}
$$

Inline $$m$$ in a table:

| name | value   |
| ---- | ------- |
| mass | $$m$$   |
| c    | $$3e8$$ |

\`\`\`mermaid
graph TD;
A[Start] --> B{Decide};
B -->|yes| C[Ship];
B -->|no| D[Iterate];
\`\`\`

\`\`\`mermaid
sequenceDiagram
Alice->>Bob: Ship WP2?
Bob-->>Alice: Green gates first.
\`\`\`

A \`math\` fence stays a plain fence:

\`\`\`math
E = mc^2
\`\`\`
`,
  "wiki/hub.md": `# Hub

Links: [[target note]], aliased [[target note|the target]], an anchor [[target note#section]], and a missing [[missing note]].

Embed placeholder: ![[target note]]

- [ ] follow up on [[target note]]
`,
  "wiki/target note.md": `# Target note

## Section

The hub links here. Backlinks arrive in a later phase.

| feature | status |
| ------- | ------ |
| embeds  | live   |
| tables  | boxed  |
`,
  // Phase F knowledge notes — an interlinked cluster so tabs, chips,
  // backlinks, transclusion (incl. guards), graph, and search all demo well.
  "wiki/ideas.md": `# Ideas

Seeds worth growing, linked from the [[hub]].

- Build a [[target note|target]] deep-dive
- Cross-link with [[wiki/projects|projects]]
- Chase the [[missing note]] ghost

Embedded reference: ![[target note]]
`,
  "wiki/projects.md": `# Projects

Active work, paired with [[ideas]].

1. Ship the knowledge UI (see [[hub]])
2. Write the [[target note#Section|section notes]]
`,
  "wiki/digest.md": `# Digest

A transclusion sampler over the wiki cluster.

Full embed: ![[ideas]]

Missing embed: ![[missing note]]

Self embed (cycle guard): ![[digest]]
`,
} satisfies Record<string, string>;
