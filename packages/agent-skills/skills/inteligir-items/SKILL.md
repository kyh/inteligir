---
name: inteligir-items
description: The items of an inteligir library — saved links, videos, images, PDFs, files and notes — their keys, their cover and wrapper, Unsorted, folders and tags, and how to save, file and tag one. Read this before saving, filing or tagging an item.
---

# inteligir Items

The library is everything the person saved and wrote, and every item in it is
one markdown file: a saved link is a note whose frontmatter says what it is and
whose body is the page's readable text; an image, a PDF or any other file is
the original beside a small note that embeds it; a note the person writes is
an item too. One shape is what lets search, history, sync, the phone and you
work on every item alike. Talk to the person about their library and its
items, folders and tags, never about files or markdown.

## Kinds And Keys

An item's `kind` is one of `link`, `video`, `audio`, `image`, `pdf` or `file`;
a note has no `kind` at all. The app writes every item key, so never invent
one, never copy one between items, and never change one that is there.

| Key           | What it is                                                 | Who writes it                  |
| ------------- | ---------------------------------------------------------- | ------------------------------ |
| `id`          | The item's identity; links and its annotations point at it | the save                       |
| `kind`        | What the item is                                           | the save, and the page's read  |
| `url`         | Where a saved link points, as it was saved                 | the save, once                 |
| `site`        | The publisher's name                                       | the page's read                |
| `author`      | Who wrote the page                                         | the page's read                |
| `published`   | When the page says it was published                        | the page's read                |
| `saved`       | When it was saved (`2026-10-17T09:12:30Z`)                 | the save, once                 |
| `fetched`     | When the page was last read                                | the page's read                |
| `fetch-error` | Why the page could not be read, in a sentence              | a failed read                  |
| `description` | One line on what the item is                               | the page's read, or the person |
| `tags`        | The person's tags                                          | you, with `inteligir tag add`  |
| `pinned`      | `true` keeps it first                                      | the person                     |

There is no `title` key: the filename is the title. A link with `url` and
`saved` but no `fetched` is waiting for the device that saved it to read its
page; leave it, the app fills it.

A saved link after its page was read:

```markdown
---
id: 7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17
kind: link
url: https://stephango.com/file-over-app
site: Steph Ango
author: Steph Ango
published: 2023-07-01
saved: 2026-10-17T09:12:30Z
fetched: 2026-10-17T09:12:33Z
description: If you want to create digital artifacts that last, they must be files you can control.
---

![](assets/covers/3f9a0c2b1d4e5f60.jpg)

For Tuesday.

File over app is a philosophy: if you want to create digital artifacts that last, they must be files you can control.
```

## The Cover And The Wrapper

A link's cover is the first image its body embeds, a picture under
`assets/covers/` named by its own bytes. The person's note on the link sits
under the cover, the page's text under that, and a kept copy of the page last,
as a link to `assets/pages/`. Never write a cover path into the frontmatter.

An image, a PDF or another file is a wrapper: a small item whose body is one
embed of the original, which sits where a pasted file would (by default
`assets/`).

```markdown
---
id: 0e5b3c1a-9a51-4f0e-8a0c-0b7f9d3a2c11
kind: pdf
saved: 2026-10-17T09:12:30Z
---

![](<assets/Lecture notes.pdf>)
```

## Unsorted, Folders And Tags

A save lands in `Unsorted/` unless it names a folder. Folders are ordinary
folders and nest; tags are the frontmatter's `tags` list, spelled without the
`#`, a letter first, `a/b` nesting. An item that is not a note takes its tags
from its frontmatter alone: a `#word` in a saved page's text is the page's,
not the person's.

The library's own filing rules, when the person wrote some, are its `AGENTS.md`
at its top. Read them before you file, tag or rename anything, and follow them
over your own taste. Without them, file by topic into folders that exist, make
a new folder only for five or more items, and tag by topic, never by kind.

## Saving, Finding, Filing

- Save with `inteligir save <url>` (or a file's path), never by writing a link
  item yourself: the save dedupes, mints the keys and reads the page.
- Before saving, `inteligir item find <url>` says where the library already
  holds it; a save of a held link adds its tags to that item instead.
- `inteligir item refresh <path>` reads a saved link's page again.
- File an item with `inteligir vault rename <path> <folder>/<name>`, which
  rewrites the links to it; tag it with `inteligir tag add <tag> <path>`,
  reusing the tags `inteligir tags` lists before you make a new one.
- List what to work on with `inteligir items` (`--folder Unsorted`,
  `--untagged`, `--kind link`, `--json`), a page at a time.

## What You Must Not Touch

- Never edit a page copy (`assets/pages/*.html`); it is the page as it was.
- Never move, rename or delete a file an item embeds on its own (its cover,
  its original): the item would lose it. Deleting the item takes the files
  only it embeds.
- Never change an item's `url`, `saved` or `id`, and never rewrite a saved
  page's text to "clean it up": the person's highlights are anchored in it.
- Files over 10 MB are not kept in the library: a larger file is refused, and
  a video or a song is saved as a link to it instead.

## Before You Finish

- Every item you saved went through `inteligir save`, not a hand-written file.
- No key you did not come to change moved: `id`, `kind`, `url`, `saved` and
  the read's keys are byte-identical to what you found.
- Every item you filed sits where the library's filing rules say, and every
  tag you added reuses the library's own when one fits.
- No cover, original or page copy was moved, edited or left behind.
