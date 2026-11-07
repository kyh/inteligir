# @repo/page-reader

A saved page read into an item: what the page says about itself (its title,
site, author, date, description, cover candidates and oEmbed link) and its
article, written as the editor's own fixpoint, so an item opens rich and its
first edit is a minimal diff.

## Why it exists

A saved link is read by whatever can read it: the Worker's fill for a paste, an
import or an agent's save, the extension's worker for the page it is on, and
the phone's editor page for its share sheet. All three read a page with this
one package, so a link reads the same whichever read it. The host hands the
DOM: `linkedom-page` where it has none of its own (the Worker, the extension's
worker, the phone's runtime under the e2e suite), the WebView's own `DOMParser`
on the phone. The bytes a page is read from are always fetched by the host;
nothing here dials.

## Layout

- `extract-page.ts` — the head read before the extractor strips it, defuddle's
  readable content, and the body ladder (rich, plain, text) whose first rung
  the editor's `canonicalizeImported` keeps at least 97% of, and that article
  read into the library's blocks (`extractPageBlocks`).
- `page-meta.ts` — Open Graph, Twitter, JSON-LD and plain meta, each in its
  order of precedence, every value clipped and every url kept only as http(s).
- `html-to-markdown.ts` — turndown under the dialect's escapes.
- `page-facts.ts` — the answer's zod schema, which the phone page's bridge
  carries.
- `page-reading.ts` — that reading as blocks, in types that name no DOM.
- `read-html.ts` — the reading over linkedom, for a host with no DOM of its own.
- `web-url.ts` — the one rule for a link a page names.
- `linkedom-page.ts` — the parse of a host with no DOM of its own.

`src/extract-page.test.ts` runs the committed corpus under linkedom, and the
`phone-editor-page` scenario holds a real browser's `DOMParser` to the same
reading.
