# Decisions: @repo/page-reader

A saved page read into an item: its facts and its article.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Reading a page

- **ONE READING OF A PAGE, OVER THE DOM ITS HOST HANDS IT.** `extractPage` takes
  the html and the host's parse (`ParsePage`): linkedom on node
  (`linkedom-page.ts`), a browser's own `DOMParser` elsewhere; it imports no
  node module and no React (`oxlint.config.ts`) and dials nothing, since every
  byte it reads its host fetched. Its answer's schema (`page-facts.ts`) is the
  one each wire carries. Rejected: a reader per host, two spellings of one
  item; and jsdom as a browser's stand-in in the suite, whose DOM makes
  defuddle keep a page's chrome where linkedom and a real browser do not.
  `packages/page-reader/src/extract-page.ts`.

- **A SAVED PAGE IS THE EDITOR'S OWN FIXPOINT.** The article is converted down a
  ladder (rich, plain, text) and the first rung the editor's
  `canonicalizeImported` calls canonical with at least 97% of the converted
  letters kept is written, so an item opens rich and its first edit is a
  minimal diff; a page's `{{x}}`, `@2026-01-02`, `%%`, `:::`, `$$`, `[[x]]` and
  raw tags are escaped so they stay text, and a code block that names one of
  the dialect's own fences (`@repo/notes/markdown/fence-langs`) as its language
  keeps its code and loses the name, so a page never writes a runnable block.
  Rejected: defuddle's markdown, Plate's `deserializeHtml`, and canonicalizing
  on first open. `packages/page-reader/src/html-to-markdown.ts`.
