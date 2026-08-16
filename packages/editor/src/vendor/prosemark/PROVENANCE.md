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

Every patched site carries a `// PATCHED:` comment.

- Every file: two-line attribution header prepended.
- `lib/decoration-update-filter.ts` — **added, house-authored** (not
  upstream): the facet seam `hide/core.ts` and `fold/core.ts` consult before
  rebuilding decorations on a selection-only transaction, so the house
  drag-freeze extension can defer rebuilds without forking the fields.
- `lib/hide/core.ts`, `lib/fold/core.ts` — the `update()` guard routes
  selection-only rebuilds through that seam.
- `lib/clickLink.ts` — imports `EditorView` from `@codemirror/view` instead of
  the `codemirror` metapackage; explicit `return undefined` in the
  `iterChildren` callback (`noImplicitReturns`).
- `lib/hide/index.ts` — `firstChild!` replaced with a null guard (this repo
  forbids non-null assertions).
- `lib/fold/image.ts` — explicit `return undefined` on the no-URL path
  (`noImplicitReturns`).
- Widget classes in `blockQuote.ts`, `codeFenceExtension.ts`,
  `tabWidthExtension.ts` and `fold/{task,bulletList,horizontalRule,dashes,image}.ts`
  — `override` modifiers added (`noImplicitOverride`).
- `lib/revealBlockOnArrow.ts` — upstream `eslint-disable` directives stripped
  (unmatched directives are errors under this repo's oxlint config).
- `tests/*.test.ts` — ported from `bun:test` to vitest; `.ts` import
  extensions dropped (`allowImportingTsExtensions` is off here).

## Re-vendor recipe

Clone upstream at a newer commit, diff `packages/core/{lib,tests}` against this
directory ignoring the header lines and `// PATCHED:` blocks, re-apply the
patches above, update the commit pin here, and run the package tests.
