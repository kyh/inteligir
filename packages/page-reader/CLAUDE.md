# Decisions: @repo/page-reader

A saved page read into an item: its facts and its article.

## Reading a page

- **One reading of a page, over the DOM its host hands it.** `extractPage` takes the html and the
  host's parse, linkedom on node and `DOMParser` elsewhere, and dials nothing, since a reader per
  host is two spellings of one item. `packages/page-reader/src/extract-page.ts`.
- **A saved page is the editor's own fixpoint.** The first rung of the ladder (rich, plain, text)
  that keeps 97% of its letters is written as the editor writes it, every mark escaped, so a page
  never writes a runnable block. `packages/page-reader/src/html-to-markdown.ts`.
- **A read page is also the library's blocks.** `extractPageBlocks` reads the canonical article
  through the editor's codec into `article` blocks, since a second html-to-blocks path would draw
  what the markdown never held. `packages/page-reader/src/extract-page.ts`.
- **A page's article is its readable part's leading 192 KiB of markup, cut between whole blocks.**
  Reading costs time and heap by length (two and a half minutes and 1.5 GB for 5 MiB), so every
  device reads by the one budget. `packages/page-reader/src/extract-page.heap.test.ts`.
- **A device keeps a reading only for its article; the fill, the last reader, keeps a page that
  named itself.** An item saved read is never filled, so a device hands the fill what it could not
  read, and nothing reads after the fill. `packages/contract/src/items/link-fill.ts`.
