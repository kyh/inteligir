# @repo/editor

The item editor: Plate bound to a note's live document, the dialect's markdown
on Plate's stock reader and writer, and the headless codec an import and the
agent read and write an item through. Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Why it exists

The editor is the largest single thing in the product, and its markdown has one
invariant: **a read keeps every letter, and a write keeps what it means**. As a
package, the rule table, the suites that hold its meaning and the kit-parity
guards live together, and every host consumes one editor: the library tab
(`apps/web/src/library`), the phone's DOM component
(`apps/mobile/src/editor/page/note-page.tsx`) and, headless, the cell's codec
(`packages/service/src/library/library-router.ts`). It reaches `@repo/contract`
and `@repo/ui`, and no node, oRPC or shell.

## Layout

```
src/
  markdown/      the dialect over Plate's stock markdown: the plugin list, the rule table, the read
                 that refuses with a reason, fence names, frontmatter, `serializeNote`
  codec/         an item as markdown, headless: an import's plan and file, the agent's view and edits
  kits/          the plugin kits: the shared content kit, the desktop and touch profiles, the headless mirror
  nodes/         every node type as a Base (headless) + React pair
  item/          an item edited by its id: its editor, its note's connection, its properties
  live/          a note's live document: the binding, the blocks it seeds and reads, a writer's edits
  formulas/, mention/, properties/   formula pills, the `[[` picker, the properties panel
  knowledge/, items/, text/, lib/    an import's link targets, a file's facts, the one diff, helpers
  test-support/  the fake host, memory notes behind a fake socket, the corpus fixtures
  *.ts(x)        the editor surface and its in-document affordances, and the host seam
styles.css       the one stylesheet a host imports, its selectors spelled in `style-hooks.ts`
```

## Seams

- `host-io.ts`: the host, `EditorHost`, a module singleton each host installs
  once through `installEditorHost` ahead of the first render
  (`apps/web/src/library/item/page-editor-host.ts`,
  `apps/mobile/src/editor/page/page-host.ts`); every action is required, so a
  host that leaves one out fails to typecheck. `host.ts` is React's door to the
  library's titles.
- `item/note-connection.ts`: a note's live document over the host's `notes`
  port, and `item/item-editor.tsx` its surface.
- `editor-profile.tsx`: the touch profile a phone host sets around the column.
- `live-editor.ts`: a mounted editor reached by the id of the item it holds.

## Testing

```bash
pnpm --filter @repo/editor test
```

Two vitest projects: `editor` (node, `*.test.ts`, a 512MB heap) for the
grammar, the codec, the matrix and the corpus (`md-matrix.test.ts`,
`md-corpus.test.ts` over `src/test-support/fixtures/`, never formatted); and
`editor-dom` (jsdom, `*.test.tsx`) for the components, compiled by the React
Compiler as the shipped page is. Component tests drive the DOM with
`fireEvent`; `typing-budget.test.tsx` holds typing in a 10k-line note to its
recorded budget.
