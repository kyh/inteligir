# inteligir Links

A link to an item moves between items in the library. Markdown links go out to the web. Image
syntax is for something that should render, not for something to click.

## Links To Items

```markdown
[Queue Design](mention:9e64c3df-c1e2-4a4d-8c07-91528f422413)
```

`read_item` writes every link to an item as `[Title](mention:<id>)`: the item's title as it is now,
and the id of the item it points at. That id is the link: it keeps pointing at the right item after
a rename, and the reader sees the item's title, never the id. **Keep every id you read, exactly.**
To link to an item you found, write its title and the id `search_library` or `list_items` answered;
never type an id from memory: a link to an id no item holds keeps only its words.

When you create or edit a note, `[[Title]]` links the one item with that title, case aside, and
`read_item` writes it back as `[Title](mention:<id>)`. If no item has the title, or more than one
does, it stays plain text and never becomes a link later, so check the title first, and use the
id form whenever you have the id. A link links a whole item: in `[[Title#Heading]]` or
`[[Title|shown words]]` the heading and the words go, and `[[#Heading]]` stays text.
`![[Title]]` is a plain link too: nothing pulls another item's text in. A `\[\[…]]` in what you
read is the person's own brackets, plain text; leave it as it is.

`read_item` also answers which items link to this one and which it links to, so you need not
search the library's text for them.

## External Links

```markdown
[the RFC](https://example.com/rfc)
```

Use a label that says where it goes. Preserve existing destinations exactly. Never author
`javascript:`, `data:`, `file:`, or a URL carrying credentials. A bare address is a link too,
which `read_item` writes as `<https://example.com/rfc>`, and a link's title after its address
(`"…"`) is dropped.

## Embeds And Files

| Intent                      | Syntax                               |
| --------------------------- | ------------------------------------ |
| A picture the library holds | `![Alt text](assets/<sha>)`          |
| A file the library holds    | `![](assets/<sha>/report.pdf)`       |
| Video, tweet, or page card  | `![](https://example.com/watch?v=…)` |

An image, a file or an embed is a block of its own: written inside a sentence, it splits the
paragraph around it.

`read_item` writes every file the library holds as `assets/` and its content hash, with the file's
name after it when it has one. Keep those addresses exactly as you read them: moving one into
another item's text embeds the same file there, and an address you typed names nothing. You cannot
add a file of your own; a picture or a PDF comes into the library from the person's devices.

Nothing remote loads inside an item: a remote image, video, tweet or page shows as a card that
opens in the browser. An embed has no alt text; `![Chart](https://…)` with alt text is a remote
image.

## Before You Finish

- Every link to an item names one by an id you read, or by a title only one item holds.
- Every link id you read is untouched.
- External destinations are unchanged and use a safe scheme.
- Every `assets/` address is one you read, exactly.
