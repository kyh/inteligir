# inteligir Links

Wiki links move between items in the library. Markdown links go out to the web. Image syntax is for
something that should render, not for something to click.

## Wiki Links

```markdown
[[Queue Design]]
[[Queue Design#Rollback]]
[[#Rollback]]
[[Queue Design|the design note]]
[[Queue Design|9e64c3df-c1e2-4a4d-8c07-91528f422413]]
```

The body of a wiki link is `target`, then an optional `#heading`, then an optional `|alias` — and
**the LAST pipe starts the alias**, so a title containing a pipe still works.

`read_item` writes every link to an item as `[[Title|id]]`, or `[[Title\|id]]` in a table cell: its
title as it is now, and after the last pipe the id of the item it points at. That id is the link: it
keeps pointing at the right item after a rename, and the reader sees the item's title, never the id.
**Keep every id you read, and never replace one with a display alias** — you would be throwing away
the only durable pointer in the link. To link to an item you found, write its title and the id
`search_library` or `list_items` answered; never type an id from memory.

A link written `[[Title]]` with no id finds the item of that title or alias. One that finds
nothing renders dashed and offers to create the note — that is a working state, not an error, and
it is the right way to write toward a note that does not exist yet.

Rules worth the keystrokes:

- Match the target's real title. Check it; do not guess from a heading.
- `[[#Heading]]` stays inside the current item.
- Escape a literal hash in a title as `\#`; a `#` surrounded by spaces is title text, not an
  anchor.
- A `#` anchor matches the heading loosely (case and spacing are forgiven). If two headings collide,
  link the section a different way rather than shipping an ambiguous anchor.
- Wiki links do not render inside a highlight's note. In a note on a highlight, name the item in
  prose.

`read_item` also answers which items link to this one and which it links to, so you need not
search the library's text for them.

## External Links

```markdown
[the RFC](https://example.com/rfc)
```

Use a label that says where it goes. Preserve existing destinations exactly. Never author
`javascript:`, `data:`, `file:`, or a URL carrying credentials.

## Embeds And Files

| Intent                      | Syntax                               |
| --------------------------- | ------------------------------------ |
| Transclude another item     | `![[Some Note]]`                     |
| A picture the library holds | `![Alt text](assets/<sha>)`          |
| A file the library holds    | `![](assets/<sha>/report.pdf)`       |
| Video, tweet, or page card  | `![](https://example.com/watch?v=…)` |

`![[Some Note]]` pulls that item's text in for reading; it does not copy it, so the source item
stays the one place to edit it.

`read_item` writes every file the library holds as `assets/` and its content hash, with the file's
name after it when it has one. Keep those addresses exactly as you read them: moving one into
another item's text embeds the same file there, and an address you typed names nothing. You cannot
add a file of your own; a picture or a PDF comes into the library from the person's devices.

Nothing remote loads inside an item: a remote image, video, tweet or page shows as a card that
opens in the browser. An embed has no alt text; `![Chart](https://…)` with alt text is a remote
image.

## Before You Finish

- Every wiki target names a real item, or is deliberately dashed.
- Every link id and heading anchor you read is untouched.
- External destinations are unchanged and use a safe scheme.
- Every `assets/` address is one you read, exactly.
