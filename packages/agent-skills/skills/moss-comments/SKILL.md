---
name: moss-comments
description: Comment annotation and sidecar rules for Moss notes. Use when adding, replying to, resolving, preserving, or editing comments and comments.json.
---

# Moss Comments

Use comments for explicit questions, decisions, approvals, or review points that need attention on exact evidence. Fix ordinary wording, duplication, and scannability issues directly instead of leaving editorial comments.

A root comment has body markers plus a matching `comments.json` entry. Replies exist only in the sidecar and connect through `parentId`.

## Execution Context

Use these attribution values:

| Writer                                   | `source` / `resolvedBy` |
| ---------------------------------------- | ----------------------- |
| Human using Moss UI                      | `user`                  |
| Moss's in-app agent                      | `agent`                 |
| Agent or tool editing files outside Moss | `external`              |

Do not write `user` for agent-authored content. Preserve missing attribution as legacy/unknown instead of backfilling it.

## Body Markers

Wrap the exact annotated range:

```markdown
The %%m:c1:start%%current layout%%m:c1:end%% needs review.
```

- IDs may contain letters, digits, `_`, and `-`.
- Generate an ID that does not already exist in the body or sidecar; no particular prefix is required.
- Start and end markers are both required and use the same comma-separated IDs.
- Multiple roots may share a range: `%%m:a,b:start%%text%%m:a,b:end%%`.
- Only root IDs appear in body markers.

Wrap an entire inline pill rather than placing markers inside it. Put block markers on standalone lines around the whole image, chart, HTML block, code fence, or other block node. Never place markers inside wiki links, formulas, color pills, fenced payloads, or raw HTML comments.

## Sidecar Schema

`comments.json` is a JSON object keyed by comment ID. Required fields use Unix timestamps in seconds.

| Field        | Required        | Contract                                                         |
| ------------ | --------------- | ---------------------------------------------------------------- |
| `text`       | Yes             | Comment or reply text.                                           |
| `createdAt`  | Yes             | Finite Unix timestamp in seconds; do not change after creation.  |
| `updatedAt`  | Yes             | Finite Unix timestamp in seconds; update when the entry changes. |
| `source`     | New entries     | `user`, `agent`, or `external`.                                  |
| `parentId`   | Replies only    | Existing root or reply ID; no cycles or dangling targets.        |
| `imageUrls`  | No              | Note-relative paths under `assets/`.                             |
| `resolvedAt` | Resolved thread | Finite Unix timestamp in seconds.                                |
| `resolvedBy` | When known      | `user`, `agent`, or `external`.                                  |

Complete user-root and external-reply example:

```json
{
  "c1": {
    "text": "Should this ship in the first phase?",
    "createdAt": 1707900000,
    "updatedAt": 1707900000,
    "source": "user"
  },
  "c1-r1": {
    "text": "The first phase is now reflected in the plan.",
    "createdAt": 1707900100,
    "updatedAt": 1707900100,
    "source": "external",
    "parentId": "c1"
  }
}
```

The app may retain legacy singular `imageUrl`; preserve it, but author new attachments with `imageUrls`.

## Location And Permissions

- Workspace note: use `comments.json` beside the Markdown content file.
- External note: use only the sidecar path Moss provides; do not invent one.
- The in-app agent may edit only the active note's sidecar.
- An external writer may edit an accessible sidecar directly while preserving unrelated entries.

## Replies, Resolution, And Deletion

- A root has no `parentId`; a reply may point to the root or another reply.
- Every reply must be reachable from a marked root through a non-cyclic parent chain.
- Leave ambiguous questions or requests needing confirmation open; reply when useful.
- After completing a clear request, set the same `resolvedAt` and appropriate `resolvedBy` on the root and every descendant, and update every affected `updatedAt`.
- Keep body markers and sidecar entries when resolving.
- Resolving must not change the user's selected comment visibility filter; continue through remaining actionable threads.
- Deletion is a separate confirmed user action that removes root markers plus every sidecar entry in the thread.

## Mentions And Images

Attachment paths are note-relative, for example `assets/comment-abc.png`. Resolve them against the note directory.

Mentions in comment text use U+2063 before and U+2064 after the displayed reference: `\u2063@Project Plan\u2064` for a note or `\u2063@folder:Launch assets\u2064` for a folder. When Moss knows the target's ID it appends it after a U+2062 separator — `\u2063@Project Plan\u2062<note-id>\u2064` — and that ID, not the title, is what resolves the link. Preserve existing wrappers and ID segments verbatim, and drop the ID segment when rendering a mention as plain text. Create mentions through Moss UI; an external writer must not invent a reference from display text alone.

- Comment text renders as plain text plus @mention pills. Wiki links (`[[Note]]`, `[[#Heading]]`) and Markdown links do not render in comment text; they stay literal text.
- To reference a note or folder in a comment you author, write the mention encoding: U+2063, then `@Note Title` (or `@folder:Folder Path`), then optionally U+2062 plus the target ID, then U+2064. A note mention without an ID resolves by title.
- Headings and sections cannot be mentioned; point at them with a plain-text description such as the section name plus the opening words of the target.

## Final Check

- Every marked root has one valid sidecar entry and every root entry has markers.
- Reply chains reach a marked root and contain no cycles.
- Attribution matches the actual writer.
- Timestamps and attachment paths use the documented formats.
- Resolution preserves markers, metadata, and the current visibility filter.
