---
name: inteligir-links
description: Wiki links, heading anchors, aliases, id-resolved links, external links, embeds, and vault media in inteligir notes.
---

# inteligir Links

Wiki links move between notes in the vault. Markdown links go out to the web.
Image syntax is for something that should render, not for something to click.

## Wiki Links

```markdown
[[Queue Design]]
[[Queue Design#Rollback]]
[[#Rollback]]
[[Queue Design|the design note]]
[[Queue Design|9e64c3df-c1e2-4a4d-8c07-91528f422413]]
```

The body of a wiki link is `target`, then an optional `#heading`, then an
optional `|alias` — and **the LAST pipe starts the alias**, so a title
containing a pipe still works.

An alias shaped like a uuid is not a label: it is the target note's identity,
written when the app resolved the link. It keeps pointing at the right note
after a rename, and the reader sees the note's title, never the uuid. **Never
type one yourself, and never replace one with a display alias** — you would be
throwing away the only durable pointer in the link.

Resolution walks: exact path, then filename, then path suffix, then frontmatter
`aliases`. A link that resolves to nothing renders dashed and offers to create
the note — that is a working state, not an error, and it is the right way to
write toward a note that does not exist yet.

Rules worth the keystrokes:

- Match the target's real filename. Check it; do not guess from a heading.
- `[[#Heading]]` stays inside the current note.
- Escape a literal hash in a title as `\#`; a `#` surrounded by spaces is title
  text, not an anchor.
- A `#` anchor matches the heading loosely (case and spacing are forgiven). If
  two headings collide, link the section a different way rather than shipping an
  ambiguous anchor.
- Wiki links do not render inside comment text. In a comment, name the note in
  prose.

## External Links

```markdown
[the RFC](https://example.com/rfc)
```

Use a label that says where it goes. Preserve existing destinations exactly.
Never author `javascript:`, `data:`, `file:`, or a URL carrying credentials.

## Embeds And Media

| Intent                     | Syntax                               |
| -------------------------- | ------------------------------------ |
| Transclude another note    | `![[Some Note]]`                     |
| Image from the vault       | `![Alt text](assets/diagram.png)`    |
| Video, tweet, or page card | `![](https://example.com/watch?v=…)` |

`![[Some Note]]` pulls that note's content in for reading; it does not copy the
bytes, so the source note stays the one place to edit it.

Vault media lives under `assets/` and is referenced by that relative path. Do
not write `file://` or absolute local paths — they break for every other person
and every other machine that opens the vault.

## Before You Finish

- Every wiki target names a real file, or is deliberately dashed.
- Existing uuid aliases and heading anchors are untouched.
- External destinations are unchanged and use a safe scheme.
- Media uses a vault-relative `assets/` path.
