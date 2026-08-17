# Vendored: bb's CLI output discipline

- **Upstream**: https://github.com/get-bb/bb, `apps/cli`
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-17

What came from bb is a discipline rather than a feature: one JSON output path
per command, an error-message walk that digs the actionable cause out of a
`fetch failed`, and a fitness test that walks the command tree so a new leaf
cannot ship without `--json`. Every command in `src/commands/` is house, which
is why the record is per file. bb builds its tree with commander and this CLI
builds it with citty, so the discipline is what carried over, not the wiring.

Vendored rather than depended on because bb publishes no packages.

## Attribution

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                                          | Upstream                                                     | Carried  |
| --------------------------------------------- | ------------------------------------------------------------ | -------- |
| `src/cli-error.ts`                            | `apps/cli/src/commands/helpers.ts`, `apps/cli/src/action.ts` | vendored |
| `src/output.ts`                               | `apps/cli/src/commands/helpers.ts`                           | adapted  |
| `src/__tests__/json-flag-enforcement.test.ts` | `apps/cli/src/__tests__/json-flag-enforcement.test.ts`       | adapted  |

## Partial copies

Each row covers a minority of its file, and saying which part is the point of
the row:

- `src/cli-error.ts` — `getErrorMessage` is upstream's function, its comment
  about `fetch failed` and AggregateError included word for word. `CliExitError`
  keeps the name and `exitCode` but takes an options object and adds `code`;
  the exit-code table is house, and its values differ from bb's (which scopes
  its codes to `thread wait`).
- `src/output.ts` — only `JsonOutputOptions` and `outputJson` are upstream's,
  and `outputJson` is `adapted` rather than `vendored`: it writes the document
  with `process.stdout.write` where upstream calls `console.log`, because this
  CLI's human path goes through consola and the JSON path must not. Everything
  else in the module is house — `requireOk` and `isOkResponse`, which are the
  reason it exists and have no bb counterpart, and the consola sinks.

`src/__tests__/json-flag-enforcement.test.ts` is `adapted` because it changes
what the suite proves. Upstream's single test reads its parser's metadata; this
one keeps that test and adds four that boot a fixture server and EXECUTE every
leaf three ways, asserting one JSON document on stdout, a non-zero exit with
empty stdout on a refusal, and an error envelope on stderr.

The tree walk `collectLeafCommands` (`src/command-tree.ts`) carries no claim.
It began as upstream's function and no longer shares code with it: citty holds
subcommands in a RECORD of `Resolvable`s rather than commander's array, so the
walk unwraps rather than iterates, refuses a lazily-declared subtree, and is
read by `--help` and the unknown-flag gate as well as by the tests. That is an
influence, which this repo credits without claiming a copy.

## Re-vendor recipe

Clone upstream at a newer commit and diff each row's upstream file against its
counterpart here, ignoring the notice lines and expecting the partial coverage
above. Update the commit pin here and run this app's tests.
