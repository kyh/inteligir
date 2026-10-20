# @repo/page-reader

A saved page read into an item: what the page says about itself (its title,
site, author, date, description, cover candidates and oEmbed link) and its
article, written as the editor's own fixpoint, so an item opens rich and its
first edit is a minimal diff.

## Why it exists

Every device that saves a link fills it: the Mac in its fill worker, a thread
with no network, and the phone in its editor page's WebView, which reaches no
network either. Both read a page with this one package, so a link reads the
same whichever device saved it. The host hands the DOM: `linkedom-page` on
node (the Mac's worker, the phone's runtime under the e2e suite), the
WebView's own `DOMParser` on the phone. The bytes a page is read from are
always fetched by the host; nothing here dials.

## Layout

- `extract-page.ts` — the head read before the extractor strips it, defuddle's
  readable content, and the body ladder (rich, plain, text) whose first rung
  the editor's `canonicalizeImported` keeps at least 97% of.
- `page-meta.ts` — Open Graph, Twitter, JSON-LD and plain meta, each in its
  order of precedence, every value clipped and every url kept only as http(s).
- `html-to-markdown.ts` — turndown under the dialect's escapes.
- `page-facts.ts` — the answer's zod schema, which the Mac's worker wire and
  the phone page's bridge both carry.
- `web-url.ts` — the one rule for a link a page names.
- `linkedom-page.ts` — the node host's parse.

`src/extract-page.test.ts` runs the committed corpus under linkedom and under a
browser's `DOMParser` (jsdom's), holding the same promises for both.
