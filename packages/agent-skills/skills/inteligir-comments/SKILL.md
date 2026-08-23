---
name: inteligir-comments
description: Anchored comments in inteligir notes — body markers, the per-note sidecar, replies, resolution, and attribution.
---

# inteligir Comments

A comment is a question, decision, or review point attached to exact evidence.
Ordinary wording and structure problems are not comments — fix those in the
text and move on.

A comment thread is two halves that must agree: **markers in the note's body**
and **an entry in the sidecar**. One without the other is a broken thread.

## Body Markers

Wrap exactly the text the comment is about:

```markdown
The %%i:c1:start%%rollback path%%i:c1:end%% is unproven.
```

- Ids may hold letters, digits, `_`, and `-`. Pick one that appears nowhere else
  in the note or its sidecar.
- Both edges are required and must carry the same ids.
- Several threads can share one range: `%%i:a,b:start%%text%%i:a,b:end%%`.
- Only root ids appear in the body. Replies live in the sidecar alone.

Put markers **around** a whole inline pill or link, never inside one. To comment
on a block — an image, chart, canvas, HTML block, or fence — put each marker on
its own line above and below the block.

Markers inside a code fence are inert, like everything else in code.

Legacy `%%m:` markers from imported vaults still parse; leave them, and write
`%%i:` in anything new.

## The Sidecar

`<note>.md.comments.json` sits beside the note — `Roadmap.md` pairs with
`Roadmap.md.comments.json`. It is a JSON object keyed by comment id.

| Field        | Required    | Contract                                            |
| ------------ | ----------- | --------------------------------------------------- |
| `text`       | yes         | The comment or reply                                |
| `createdAt`  | yes         | Unix seconds; never changes after creation          |
| `updatedAt`  | yes         | Unix seconds; bump whenever the entry changes       |
| `source`     | new entries | `user`, `agent`, or `external`                      |
| `parentId`   | replies     | An existing id in this file; no cycles, no dangling |
| `imageUrls`  | no          | Vault-relative paths under `assets/`                |
| `resolvedAt` | resolved    | Unix seconds                                        |
| `resolvedBy` | when known  | `user`, `agent`, or `external`                      |

```json
{
  "c1": {
    "text": "Is the rollback rehearsed, or only written down?",
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

| Who wrote it                                  | `source` / `resolvedBy` |
| --------------------------------------------- | ----------------------- |
| A person in the app                           | `user`                  |
| The app's own agent                           | `agent`                 |
| A coding agent or tool editing files directly | `external`              |

If you are an agent, you are `agent` or `external` — never `user`. Missing
attribution on an old entry means unknown; leave it that way rather than
guessing.

## Replies, Resolving, Deleting

- A root has no `parentId`. A reply points at the root or another reply, and
  every reply must chain back to a root that has markers in the body.
- Answer what you can answer. Leave genuinely open questions open.
- Resolving a thread sets `resolvedAt` and `resolvedBy` on the root **and every
  descendant**, and bumps each `updatedAt`. **Keep the markers and the entries** —
  resolution is history, not deletion.
- Deleting is a person's decision. It removes the root's markers and every entry
  in the thread together.

## Before You Finish

- Every marked root has exactly one sidecar entry, and every root entry has
  markers.
- Reply chains reach a marked root with no cycles.
- `source` matches who actually wrote it.
- Timestamps are Unix seconds; attachment paths are vault-relative.
- Resolved threads kept their markers and their text.
