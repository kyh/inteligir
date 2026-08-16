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

## Not carried

- `lib/fold/emoji.ts` — the one module depending on `node-emoji`, out of scope
  for the first cut. `lib/fold/index.ts` and `lib/markdown/index.ts` are
  patched to drop its references. `lib/markdown/tags.ts` keeps the (unused)
  emoji tags byte-faithfully.
- `lib/nestedLinkAsPlainText.ts` (the top-level duplicate) — orphaned upstream;
  only `lib/markdown/nestedLinkAsPlainText.ts` is imported.
- Upstream's `ajv` dependency — declared but unused by `lib/`.
- The `codemirror` metapackage — see the `clickLink.ts` patch.

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
- `lib/blockQuote.ts` — upstream swapped the plugin's decorations inside a
  measure write without invalidating the view, so new ranges sat unrendered
  until an unrelated dispatch; the patch nudges the view with an empty
  transaction when the set changed (softIndentExtension's own pattern), with a
  destroy guard.
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
