---
name: inteligir-fields
description: An inteligir item's fields — what each one holds, which you change and with which call, and what is never invented or rewritten.
---

# inteligir Fields

An item's fields are what the library knows about it beside its text: its title, tags, folder and
pin, and for a saved item the facts its page gave. `read_item` answers them as data, never inside
the item's markdown, so a field is never something you type into the text.

## What You Change

| Field      | Change it with                                  | Contract                                          |
| ---------- | ----------------------------------------------- | ------------------------------------------------- |
| `title`    | `organize_items` with `title`, one item at once | What the person sees on the card and in links     |
| `tags`     | `organize_items` with `addTags` / `removeTags`  | A letter first, no spaces, no `#`; `a/b` nests    |
| `folderId` | `organize_items` with `folder` (id or path)     | A path names folders that are made when new       |
| `pinned`   | `organize_items` with `pinned`                  | Keeps the item first; the person's choice, mostly |

A note's title is its own field: an H1 in its text is a heading, not the title, and renaming an
item rewrites nothing, since every link to it names it by id and shows its title as it is now.

Reuse the values the library already uses instead of inventing a parallel vocabulary; a tag
`in-progress` next to twenty `active` items just splits the group in two.

## What Is The Library's

`kind`, `url`, `savedAt`, and what the page read wrote (`site`, `author`, `published`,
`description`, `fetchState`, `fetchError`) are the library's. They read like any field, but no call
of yours changes them: a saved link keeps the address it was saved at, and reading its page again
is the person's to ask for.

An item's `id` is its identity. Links, highlights and formula references point at it. Never invent
one, never copy one between items, and pass only ids an answer gave you.

`properties`, when an item has them, are the person's own and imported values. Leave them as they
are; nothing you call changes them.

## Before You Finish

- Every field you changed went through `organize_items`; none was restated in an item's text.
- Tags reuse the library's own spelling, and every one starts with a letter.
- No id you passed was invented.
