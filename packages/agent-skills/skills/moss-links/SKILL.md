---
name: moss-links
description: Create or edit Moss wiki links, heading links, aliases, resolved IDs, Markdown links, webpage previews, videos, and note-local media.
---

# Moss Links

Use wiki links for Moss navigation, Markdown links for external text links, and media/embed forms only when a rendered preview is intended.

## Wiki Links

```markdown
[[Project Plan]]
[[#Local Heading]]
[[Project Plan#Scope]]
[[Project Plan|display text]]
[[Project Plan|9e64c3df-c1e2-4a4d-8c07-91528f422413]]
```

The final form is a resolved link persisted by Moss: a UUID suffix means note identity, while a non-UUID suffix is a display alias. Preserve resolved UUID suffixes rather than replacing them with aliases or guessed IDs.

Rules:

- Verify a cross-note target and use its exact H1 title.
- If multiple notes share that title, preserve an existing resolved UUID or ask which note is intended; do not guess from folder order.
- Use `[[#Heading]]` for the current note and `[[Note#Heading]]` for another note.
- Heading matching trims and collapses spaces, ignores case, and also compares a punctuation/diacritic-normalized slug. When headings duplicate, the first matching heading is used; avoid adding an ambiguous link.
- Wiki links render only in note bodies, not in comment text; reference notes in comments with @mentions instead.
- Single brackets may appear inside titles. Escape an ambiguous title hash as `\#`, for example `[[RFC\#123]]`. Because the last `|` starts the alias or resolved-ID suffix, a title containing `|` must use a Moss-supplied resolved UUID, for example `[[Status | Draft|9e64c3df-c1e2-4a4d-8c07-91528f422413]]`. Do not author a title containing the closing sequence `]]`.

## External Text Links

```markdown
[Moss website](https://www.mossnotes.app/)
```

Use descriptive labels, preserve destinations exactly unless asked to change them, and use only schemes appropriate for the destination. Do not put `javascript:`, `data:`, `file:`, or credential-bearing URLs into authored external links.

## Webpage Previews

| Intent                  | Syntax                                            | Result               |
| ----------------------- | ------------------------------------------------- | -------------------- |
| Compact webpage context | Bare browser-safe URL                             | Inline embed pill    |
| Visual webpage card     | `![Research board](https://example.com/research)` | Webpage preview card |
| Ordinary text link      | `[Research](https://example.com/research)`        | Markdown link        |

A browser-safe webpage URL is public HTTPS, or HTTP/HTTPS loopback development content on `localhost`, `*.localhost`, `127.0.0.1`, or `::1`. Credentialed URLs, private or link-local addresses, `.local` hosts, unsupported schemes, and obvious downloadable files do not become webpage previews.

Images, YouTube, local video, and tweet status URLs use their more specific media rendering instead of the generic webpage pill.

## YouTube And Video

```markdown
![Demo walkthrough](https://youtu.be/dQw4w9WgXcQ)
```

- Image/video Markdown or a bare standalone YouTube URL creates an embedded video.
- `[Demo](https://youtu.be/...)` stays a text link.
- Remote non-YouTube video files do not become video nodes.
- Store local `.mp4`, `.webm`, or `.mov` files under the note's `assets/` directory.

## Note-Local Assets

```markdown
![Screenshot](assets/screenshot.png)
![Demo recording](assets/demo.mp4)
```

Use note-relative `assets/...` paths. Do not author `file://` or absolute local paths. Preserve existing asset paths unless moving the asset is part of the task.

## Final Check

- Link syntax matches the intended navigation, text, or preview behavior.
- Note and heading targets were verified and are unambiguous.
- Existing aliases, resolved UUIDs, fragments, and destinations remain intact.
- Preview URLs satisfy the browser-safety boundary.
- Local media uses a note-relative asset path.
