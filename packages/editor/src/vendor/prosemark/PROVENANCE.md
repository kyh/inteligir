# Vendored: @prosemark/core

- **Upstream**: https://github.com/jsimonrichard/ProseMark, directory
  `packages/core` only
- **Commit**: `1f6d43e4808dec5a8f18bdf3a5d83cab00c1195f` (package version 0.0.9)
- **License**: MIT — see `LICENSE` in this directory (© J. Simon Richard)
- **Vendored**: 2026-08-15

Vendored rather than depended on because the hide/fold cores need an internal
seam (drag-freeze) that upstream 0.0.x does not expose; writer-computer forked
the package for the same reason. Files keep upstream's camelCase names under
`lib/` and `tests/` so a re-vendor diffs cleanly — kebab-case names in this
directory mark house-authored files.

## Attribution

MIT requires the notice to travel with the copy, so every file under this
directory carries the line below —
`tools/repo-guards/src/vendor-provenance.test.ts` reads it from here and checks
the tree against it. Nothing is exempt: a second fenced block under this heading
would list the exempt paths, and there are none.

```text
Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
```

## Not carried

- `lib/fold/emoji.ts` — the one module depending on `node-emoji`, out of scope
  for the first cut. `lib/fold/index.ts` and `lib/markdown/index.ts` are
  patched to drop its references. `lib/markdown/tags.ts` keeps the (unused)
  emoji tags byte-faithfully.
- `lib/nestedLinkAsPlainText.ts` (the top-level duplicate) — orphaned upstream;
  only `lib/markdown/nestedLinkAsPlainText.ts` is imported.
- Upstream's `ajv` dependency — declared but unused by `lib/`.
- The `codemirror` metapackage — see the `clickLink.ts` patch.
- `lib/basicSetup.ts` — the turnkey setup this package's own
  `markdown-editor-extensions.ts` supersedes, and the only module depending on
  `@codemirror/autocomplete` and `@codemirror/lint`; dropping it drops both
  dependencies. `lib/main.ts` is patched to drop its re-export.

## Local patches

Every patched site carries a `// PATCHED:` comment, with two mechanical
exceptions listed at the end of this section: the added `override` modifiers
and the stripped `eslint-disable` directives, which are enumerated there
instead of marked per line.

- Every file: two-line attribution header prepended.
- `lib/hide/core.ts`, `lib/fold/core.ts` — the `update()` guard routes
  selection-only rebuilds through a house facet seam
  (`src/decoration-update-filter.ts`, OUTSIDE this directory — it is
  house-authored, so it lives under house rules; the vendored cores import it
  through the patched line). The seam is what the house drag-freeze extension
  provides values for, so rebuilds can be deferred without forking the fields.
- `lib/hide/index.ts` — the EscapeMark inline parser accepted EVERY backslash
  as an Escape, so the hide spec removed literal content (`\a`, a lone
  backslash, backslash-newline). Restricted to CommonMark's ASCII-punctuation
  escapes. Also: `firstChild!` replaced with a null guard (this repo forbids
  non-null assertions).
- `lib/fold/core.ts` — `buildDecorations` built `lineage.reverse().join('/')`
  for EVERY node in the document and then suffix-tested that string, so a
  keystroke allocated one path string per node to answer a question about each
  node's last few ancestors. Replaced with `pathEndsWith`, which consumes the
  test from its end while walking up, keeping `String.endsWith` semantics
  exactly; the path string is still built for the (unused) function-valued
  `nodePath` specs.
- `lib/blockQuote.ts` — two patches. Upstream swapped the plugin's decorations
  inside a measure write without invalidating the view, so new ranges sat
  unrendered until an unrelated dispatch; the patch nudges the view with an
  empty transaction when the set changed (softIndentExtension's own pattern),
  with a destroy guard. And `measureBlockQuotes` walked the WHOLE document —
  in a ViewPlugin, whose decorations are only ever read for the viewport, and
  whose `coordsAtPos` answers nothing off-screen anyway — so it is scoped to
  `view.visibleRanges`, the way `lib/codeFenceExtension.ts` already was.
- `lib/markdownFormattingKeymap.ts` — `insertLink` moved from `Mod-k` to
  `Mod-Shift-k`. `Mod-k` is the host app's command palette
  (`apps/app/src/app/global-shortcuts.ts`), which listens on the window: a
  CodeMirror binding preventDefaults but does not stop propagation, so both
  ran and `[]()` was spliced into the note the palette opened over. The new
  key shadows CodeMirror's `deleteLine`, which this keymap outranks anyway by
  being spread first at composition. Re-vendoring restores the collision;
  `apps/app/src/app/__tests__/global-shortcuts.test.tsx` fails when it does.
- `lib/clickLink.ts` — imports `EditorView` from `@codemirror/view` instead of
  the `codemirror` metapackage; explicit `return undefined` in the
  `iterChildren` callback (`noImplicitReturns`).
- `lib/fold/image.ts` — explicit `return undefined` on the no-URL path
  (`noImplicitReturns`).
- `tests/*.test.ts` — ported from `bun:test` to vitest; `.ts` import
  extensions dropped (`allowImportingTsExtensions` is off here).

Unmarked mechanical patches (no per-line `// PATCHED:` comments):

- `override` modifiers added for this repo's `noImplicitOverride` on every
  `WidgetType` subclass method — `Checkbox` (fold/task.ts), `BulletPoint`
  (fold/bulletList.ts), `HorizontalRuleWidget` (fold/horizontalRule.ts),
  `DashWidget` (fold/dashes.ts), `ImageWidget` (fold/image.ts),
  `NestedBlockQuoteBorder` (blockQuote.ts), `FixedTabWidthWidget`
  (tabWidthExtension.ts), `CodeBlockInfoWidget` (codeFenceExtension.ts).
- `lib/revealBlockOnArrow.ts` — upstream `eslint-disable` directives stripped
  (unmatched directives are errors under this repo's oxlint config).

## Re-vendor recipe

Clone upstream at a newer commit, diff `packages/core/{lib,tests}` against this
directory ignoring the header lines and `// PATCHED:` blocks, re-apply the
patches above, update the commit pin here, and run the package tests.
