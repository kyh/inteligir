# Decisions: @repo/page-reader

A saved page read into an item: its facts (title, site, author, date, description, cover
candidates, oEmbed link) and its article, read as a tree into the library's `article` blocks. The
extension's worker reads the page it is on and the cloud's fill every other saved link, both
through `read-html`; the host fetches the bytes, and nothing here dials. `pnpm --filter
@repo/page-reader test` runs the committed corpus.

## Reading a page

- **One reading of a page, over linkedom on every host.** The reading parses the html with
  linkedom, and `read-html` publishes a DOM-free signature (`read-html-api.ts`) for a program with
  none, since a reader per host is two spellings of one item. `packages/page-reader/src/read-html.ts`.
- **A saved page is read as a tree, and the editor's own rules read it.** Html goes to hast, to
  mdast, to blocks through `readMdast`, and no reader parses its text again, so a page never
  writes a runnable block or a construct the dialect spells, and no second html-to-blocks path
  draws what the rules never held. `packages/page-reader/src/article-tree.ts`.
- **An article keeps 97% of its page's letters, or is the page's words as plain paragraphs.** The
  blocks are counted against the words the page itself holds, and a page nested past the
  extractor's recursion reads as its words alone, since a read keeps every letter.
  `packages/page-reader/src/read-html.ts`.
- **A page's article is its readable part's leading 192 KiB of markup, cut between whole blocks.**
  The string is cut before its tree is parsed, since a tree costs heap by its markup's length
  (36 MB a MiB), so every device reads by the one budget.
  `packages/page-reader/src/extract-page.heap.test.ts`.
