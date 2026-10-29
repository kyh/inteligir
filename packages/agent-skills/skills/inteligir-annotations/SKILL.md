---
name: inteligir-annotations
description: Annotations in inteligir notes — body markers around a highlighted passage, the note's annotation store, quotes, notes, replies, and attribution.
---

# inteligir Annotations

An annotation is a highlighted passage and an optional note on it: a claim to
check, a decision, or an answer to the person's question, attached to exact
evidence. Ordinary wording and structure problems are not annotations — fix
those in the text and move on.

An annotation is two halves that must agree: **markers in the item's body**
and **an entry in the store**. One without the other is a broken annotation,
with one exception the app makes itself: an entry with a `quote` and no
markers on a saved link the Mac has not read yet is **waiting** for its page's
text. Leave it; the app places it on its passage when the page is read, or,
when the passage is not there, under a `## Highlights` heading at the end.

Prefer `inteligir annotation add <path> "<quote>" --note "<text>"`, which
finds the passage and writes both halves; write the markers by hand only when
the CLI is not there.

## Body Markers

Wrap exactly the passage the annotation is about:

```markdown
The %%i:c1:start%%rollback path%%i:c1:end%% is unproven.
```

- Ids may hold letters, digits, `_`, and `-`. Pick one that appears nowhere else
  in the note or its store.
- Both edges are required and must carry the same ids.
- Several annotations can share one range: `%%i:a,b:start%%text%%i:a,b:end%%`.
- Only root ids appear in the body. Replies live in the store alone.

Put markers **around** a whole inline pill or link, never inside one. To
annotate a block — an image, chart, canvas, HTML block, or fence — put each
marker on its own line above and below the block.

Markers inside a code fence are inert, like everything else in code.

## The Store

A note's annotations live in `.inteligir/annotations/<note-id>.json`, where
`<note-id>` is the note's frontmatter `id` (`inteligir annotation add` mints
one into a note that has none, and refuses a note whose `id` is not text, such
as `id: 42`, rather than replace it). It is a JSON object keyed by annotation
id. Copying a note copies its `id`, and two notes with one `id` share one
store: run `inteligir vault new-id <copy>` on the copy, which gives it its own
id and a copy of the store. `inteligir matches <id>` finds the copies: each row
on an `id:` line is a note carrying that id. Never delete its `id:` line,
because its anchors' bodies live only under that id.

| Field       | Required    | Contract                                                  |
| ----------- | ----------- | --------------------------------------------------------- |
| `text`      | yes         | The note or the reply; `""` on a root is a bare highlight |
| `quote`     | roots       | The passage's plain text when the highlight was made      |
| `createdAt` | yes         | Unix seconds; never changes after creation                |
| `updatedAt` | yes         | Unix seconds; bump whenever the entry changes             |
| `source`    | new entries | `user`, `agent`, or `external`                            |
| `parentId`  | replies     | An existing id in this file; no cycles, no dangling       |

```json
{
  "c1": {
    "text": "Is the rollback rehearsed, or only written down?",
    "quote": "rollback path",
    "createdAt": 1787788800,
    "updatedAt": 1787788800,
    "source": "user"
  },
  "c1-r1": {
    "text": "Rehearsed on staging; the note now says so.",
    "createdAt": 1787792400,
    "updatedAt": 1787792400,
    "source": "external",
    "parentId": "c1"
  }
}
```

Unknown fields are preserved — do not strip a key you do not recognize.

## Attribution

| Who wrote it                                  | `source`   |
| --------------------------------------------- | ---------- |
| A person in the app                           | `user`     |
| The app's own agent                           | `agent`    |
| A coding agent or tool editing files directly | `external` |

If you are an agent, you are `agent` or `external` — never `user`. Missing
attribution on an old entry means unknown; leave it that way rather than
guessing.

## Notes, Replies, Removing

- A root has no `parentId`. A reply points at the root or another reply, and
  every reply must chain back to a root that has markers in the body.
- Use an annotation to point the person at a passage; never to fix wording.
- A note on a root can be written later (`inteligir annotation edit`); an
  edit rewrites `text` and bumps `updatedAt`.
- There is no resolve. Removing is a person's decision: it takes the root's
  markers and every entry under it together.

## Before You Finish

- Every marked root has exactly one store entry, and every root entry has
  markers, unless it is waiting on a link whose page is not read yet.
- Every root you made carries the `quote` of the passage its markers wrap.
- Reply chains reach a marked root with no cycles.
- `source` matches who actually wrote it.
- Timestamps are Unix seconds.
