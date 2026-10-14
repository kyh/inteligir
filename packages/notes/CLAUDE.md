# Decisions: @repo/notes

The knowledge engine: the scan, the index's rules, search, links and tags.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

Pure and platform-neutral: no node, react or ui import and no `crypto` global
(lint-enforced), and every platform capability (the SQL driver, the clock,
random bytes and fresh ids) is injected.
`markdown/mdast-nodes.ts` is the mdast NARROWING boundary: a walk asks it what a
node is rather than discriminating structurally at each visit.

## Knowledge: index, search and links

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Literal
  and stem columns at equal bm25 weight; `@repo/notes/knowledge/search-query`
  owns the one policy both engines run. FTS5's `porter` tokenizer is rejected
  for a measured reason: it stems the index, so a prefix query for a half-typed
  word stops retrieving (86 of 1,555 prefixes over the labelled corpus), and it
  puts half a shared policy inside SQLite's C. Every term asks both halves, and
  that OR is the exact tier: a doc holding the literal word scores about twice a
  stem-only hit. Residual: the title/body gap is 10x, so a title collision still
  beats a body exact match. `search-query.ts` and `knowledge/search-excerpt.ts`.

- **THE CLIENT DOES NOT DECIDE WHAT A DOC IS.** `@repo/notes/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`. A private `.md` rule in a client hides every `.txt` note and
  disagrees on display the moment a name is not lowercase.
  `apps/workspace/src/app/__tests__/vault-hooks.test.ts` walks the page for
  either shape.

- **THE SCAN READS A NOTE IN THE EDITOR'S OWN GRAMMAR, AND THAT GRAMMAR IS
  TOTAL.** The knowledge scan walks the editor's plugin list as a bare parse
  (`@repo/notes/markdown/bare-parse`), so the index reads as prose exactly what
  the editor draws as prose: no indented code, no flow html, and math is latex,
  never a link. No input throws: the grammar has no jsx and no expressions, so
  `<` opens an html tag, an autolink or text and `{` is prose; a tag folds with
  its closer while the tree compiles
  (`@repo/notes/markdown/remark-inline-html`), so the index pairs tags exactly
  as the editor does, and a tag nothing closes stays an `html` literal. So a
  stray `{` or `<br>` costs a note neither its rich editing nor its index row.
  Rejected: a second, plain-markdown grammar for the scan, kept total beside an
  editor grammar that threw, which needed a bridge to say where the two
  disagreed. A rename's span is a licence to rewrite bytes, so the scan
  withholds spans inside a construct the editor carries as its source
  (`isOpaqueSource` in `@repo/notes/markdown/remark-opaque`, walked by
  `@repo/notes/knowledge/link-extract`); the index path emits no spans.
  `packages/notes/src/markdown/__tests__/total-grammar.test.ts`.

- **A TAG IS A SCOPE ON THE RECENT LIST, NOT A VIEW; ITS NOTES ARE A LISTING,
  NOT A SEARCH; AND A TAG RENAME IS THE LINK RENAME'S SURGERY.** No tag browser
  (owner decision): a `#tag` chip asks the shell through `showTag`
  (`EditorHostActions`, `packages/editor/src/host-io.ts`), and the rail answers with Recent
  scoped to the tag (`apps/workspace/src/app/sidebar/tagged-notes.tsx`).
  `knowledge.tagNotes` answers the tag's family with the whole count, paged,
  from the index alone, because the search route stops at its ceiling with no
  sign of a cut; the family is one predicate, `notesInTagFamily`
  (`@repo/notes/knowledge/tag-notes`). `knowledge.renameTag` splices a
  frontmatter entry over its own yaml scalar
  (`@repo/notes/markdown/frontmatter`), because re-serializing restyles a flow
  list and rewrites every line of a CRLF one, and every write is
  `writeIfUnchanged`, so a note that changed mid-rename is reported, never
  overwritten. The one name grammar is `isTagName`
  (`@repo/notes/knowledge/tag-grammar`, import-free so the contract loads no
  markdown parser). `@repo/notes/knowledge/rename-tags.ts`,
  `apps/cli/src/server/knowledge/rename-tag.ts`,
  `apps/workspace/src/app/sidebar/tag-scope.tsx`.

- **VAULT SEARCH IS A LITERAL SCAN BESIDE THE RANKED INDEX, and a replace
  rewrites exactly what the rows showed.** FTS5 cannot say where inside a line a
  hit sits, so `knowledge.matches` (the palette's "Search across the vault…",
  `inteligir matches`) scans bodies with ONE matcher,
  `@repo/notes/knowledge/text-matches`, which the listing, the rewrite and the
  find bar's jump all run; the store only pre-narrows by ascii substrings
  (`docTexts`), because LIKE folds ascii case alone. A replace is a per-file
  write with the hash of the bytes it read, and a mismatch is REPORTED by name,
  never diff3-merged: the user named exact bytes
  (`apps/workspace/src/app/palette/vault-replace.ts`). A cut listing, or one
  that no longer answers the box, cannot replace
  (`apps/workspace/src/app/palette/search-page.tsx`), and a run honours a cancel
  between notes, never inside one. The jump lands by ordinal among the note's
  matches, because a markdown column is not a Slate offset.

- **AN UNLINKED MENTION IS THE STEM OR AN ALIAS IN PROSE, and Link rewrites the
  bytes the row showed.** `knowledge.unlinkedMentions` (`inteligir unlinked`)
  runs the literal matcher over the target's names as whole words, longest
  first; one row per note, excluding notes already linking here. A hit inside
  code, math, a link, a url, frontmatter, an html tag, a comment marker, a date
  chip or a `:::` marker line is withheld by the scan's own line regexes as well
  as the editor's verbatim ranges (math, and what it carries as source). Not
  the H1: `[[H1 text]]` resolves to nothing. Link wraps exactly that site
  through a guarded write, targeting the route's `linkTarget`, because the bare
  stem may be another note's. `@repo/notes/knowledge/unlinked-mentions.ts`,
  `apps/workspace/src/app/actions/link-mention.ts`.

- **A PROBLEM IS THE RESOLVER'S VERDICT, never a scan's.** `knowledge.problems`
  (the palette's Problems page, `inteligir problems`) reads the resolved graph
  alone: unresolved links, missing embeds, orphans, and a link name
  (`wikiLinkName`) or frontmatter `id` two docs share, a tie the resolver is
  quietly breaking. Every row disappears with the sweep that fixes it, so none
  is stale. Daily notes and templates are orphans by design and left out unless
  asked (`@repo/notes/templates/folders` spells the folders). A row lands
  on the link ELEMENT (`packages/editor/src/link-locate.ts`), since the find bar
  cannot see a wiki chip's label, a prop of an inline void.
  `@repo/notes/knowledge/vault-problems.ts`.

- **AN MD URL HAS ONE READING, AND THE EDITOR RESOLVES IT WITH THE INDEX'S
  RESOLVER.** `mdLinkTarget` (`@repo/notes/knowledge/link-extract`) is how the
  scan reads an md url, and the editor reads a link's or an image's url through
  it and resolves it from the note it is written in with the index's own
  `buildResolver` (`packages/editor/src/link-resolver-feed.ts`), so the image
  Problems calls missing is the one drawn missing and a vault url opens in the
  app; only an http(s) url reaches the browser. An image the resolver misses
  falls back to a root path, because a pasted asset is on disk before the
  listing that would resolve it. `useVaultLinkTarget` in
  `packages/editor/src/host.ts`, `packages/editor/src/nodes/image-node.tsx`,
  `link-node.tsx` and `packages/editor/src/transclusion.tsx`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a link leaves off
  (`wikiLinkName` in `@repo/notes/knowledge/doc-file`), and the resolver keys
  that same name, so a `.txt` note links as `[[todo.txt]]`; letting every doc
  extension go was rejected to keep Obsidian's reading and the pinned resolver.
  The `[[` picker, Link, extract and a rename take their target from
  `wikiTargetForPath` (`@repo/notes/knowledge/link-resolve`: the name when it
  resolves back, else the path), but a rename's candidate predicate refuses the
  bare name unless no other file answers to it (`answersOnly` in
  `packages/notes/src/knowledge/rename-links.ts`), because a rename rewrites
  links the user did not type and must not lean on the resolver's tie-break.
  Every writer takes its bytes from `serializeWikiBody`
  (`@repo/notes/markdown/remark-wiki-link`), and a null from it writes nothing.
  Copy link copies the note's `[[wiki link]]` (`wikiLinkFor`), because a
  loopback URL opened nothing anywhere else and died with the port; a name no
  link can carry copies nothing and says so
  (`apps/workspace/src/app/note-topbar.tsx`). Pinned by the round trip in
  `packages/notes/src/__tests__/link-resolve.test.ts`.
