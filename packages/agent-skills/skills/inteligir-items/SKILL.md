---
name: inteligir-items
description: The items of an inteligir library — saved links, videos, images, PDFs, files and notes — their kinds and fields, Unsorted, folders and tags, and how to save, find, file and tag one. Read this before saving, filing or tagging an item.
---

# inteligir Items

The library is everything the person saved and wrote, and every item in it has one shape: fields
plus a body of text. A saved link's fields say where it points and what the page is, and its text
holds the person's note and the page's readable text; an image, a PDF or any other file is an item
whose fields name the original; a note the person writes is an item too. One shape is what lets
search, History, every device and you work on every item alike.

## Kinds And Fields

An item's `kind` is `note`, `link`, `video`, `audio`, `image`, `pdf` or `file`. `read_item` answers
its fields; the ones you change, you change with `organize_items`, and the rest are the library's.

| Field         | What it is                                       | Who changes it             |
| ------------- | ------------------------------------------------ | -------------------------- |
| `title`       | What the item is called                          | you, with `organize_items` |
| `tags`        | The person's tags                                | you, with `organize_items` |
| `folderId`    | The folder it is filed in, or none (Unsorted)    | you, with `organize_items` |
| `pinned`      | Kept first                                       | you, with `organize_items` |
| `kind`        | What the item is                                 | the save and the page read |
| `url`         | Where a saved link points, as it was saved       | the save, once             |
| `site`        | The publisher's name                             | the page read              |
| `author`      | Who wrote the page                               | the page read              |
| `published`   | When the page says it was published              | the page read              |
| `description` | One line on what the item is                     | the page read              |
| `savedAt`     | When it was saved                                | the save, once             |
| `fetchState`  | Whether the page was read: `pending` until it is | the page read              |
| `fetchError`  | Why the page could not be read, in a sentence    | a failed read              |

A link whose `fetchState` is `pending` is waiting for the library to read its page; leave it, and
its text fills in on its own. One whose read failed keeps its address and says why in
`fetchError`.

## Unsorted, Folders And Tags

A save lands in Unsorted unless it names a folder. Folders nest, and `organize_items` files into a
folder by its id or by its path (`Reading/Essays`), making the folders a new path needs. Tags are
spelled without the `#`, a letter first, `a/b` nesting. An item that is not a note takes its tags
from its fields alone: a `#word` in a saved page's text is the page's, not the person's.

`list_tags_and_folders` lists the folder tree and every tag with how many items each holds. Reuse
what is there: a tag `reading` next to forty `to-read` items splits one group in two. Without the
person's own filing rules, file by topic into folders that exist, make a new folder only for five
or more items, and tag by topic, never by kind.

## Saving, Finding, Filing

- Save a web address with `save_link`, never by writing a note that holds it: the save mints the
  item, finds the one the library already holds for that address, and reads the page. A save of an
  address the library holds keeps that item and adds the tags you passed to it.
- `search_library` finds items by what their titles, notes, articles and highlights say;
  `list_items` browses by folder, tag, kind or pin, newest first. Both answer a page at a time.
- Write a new note with `create_note`, titled, tagged and filed in one call.
- Tag, untag, file, pin and rename with `organize_items`, many items in one call when they share
  the change.
- `item_history` says who changed an item and when.

## What You Must Not Touch

- Never rewrite a saved page's article to "clean it up": it is the page as it was read, and the
  person's highlights are anchored in it.
- Never remove a file an item embeds (`assets/<sha>` in its text): the item would lose it.
- Never move items to Deleted that the person did not ask you to remove; `delete_items` asks them
  first, and Deleted is where they restore from.

## Before You Finish

- Every link you saved went through `save_link`, not a note you wrote.
- Every item you filed sits where the person's filing rules say, and every tag you added reuses
  the library's own when one fits.
- No article was rewritten, and no file an item embeds left its text.
