# Decisions: @repo/page-reader

A saved page read into an item: its facts (title, site, author, date, description, cover
candidates, oEmbed link) and its article, as the editor's own fixpoint and as the library's
`article` blocks. The extension's worker reads the page it is on and the Worker's fill every other
saved link, both through `read-html`; the host fetches the bytes, and nothing here dials. `pnpm
--filter @repo/page-reader test` runs the committed corpus.

## Reading a page

- **One reading of a page, over linkedom on every host.** `read-html` parses the html with
  linkedom and publishes a DOM-free signature (`read-html-api.ts`) for a program with none, since a
  reader per host is two spellings of one item. `packages/page-reader/src/read-html.ts`.
- **A saved page is the editor's own fixpoint.** The first rung of the ladder (rich, plain, text)
  that keeps 97% of its letters is written as the editor writes it, every mark escaped, so a page
  never writes a runnable block. `packages/page-reader/src/html-to-markdown.ts`.
- **A read page is also the library's blocks.** `extractPageBlocks` reads the canonical article
  through the editor's codec into `article` blocks, since a second html-to-blocks path would draw
  what the markdown never held. `packages/page-reader/src/extract-page.ts`.
- **A page's article is its readable part's leading 192 KiB of markup, cut between whole blocks.**
  Reading costs time and heap by length (two and a half minutes and 1.5 GB for 5 MiB), so every
  device reads by the one budget. `packages/page-reader/src/extract-page.heap.test.ts`.
