# Vendored: bb hono-typed-routes

- **Upstream**: https://github.com/get-bb/bb, directory
  `packages/hono-typed-routes`
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-17

The whole of `src/` is upstream's package. Only the scaffolding around it is
this repo's: `package.json` re-declares the dependencies against the catalog
and exports three subpaths instead of a barrel (upstream's `src/index.ts` is
deliberately not carried — no barrel files), and `tsconfig.json` /
`vitest.config.ts` are house. The record is per-file rather than
whole-directory so that scaffolding is not asked for a notice it should not
carry.

Vendored rather than depended on because bb publishes no packages.

## Attribution

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                                 | Upstream                                               | Carried  |
| ------------------------------------ | ------------------------------------------------------ | -------- |
| `src/endpoint.ts`                    | `packages/hono-typed-routes/src/endpoint.ts`           | vendored |
| `src/route-descriptor.ts`            | `packages/hono-typed-routes/src/route-descriptor.ts`   | vendored |
| `src/typed-routes.ts`                | `packages/hono-typed-routes/src/typed-routes.ts`       | vendored |
| `src/__tests__/typed-routes.test.ts` | `packages/hono-typed-routes/test/typed-routes.test.ts` | vendored |

## Local edits worth knowing before a re-vendor

- `src/typed-routes.ts` keeps upstream's whole type layer but rewrites the
  registration runtime: upstream's string-path overloads are dropped, leaving
  descriptor-only registration, and the `(app as any)[method]` casts become a
  `mount` switch over four type predicates. Upstream's validation flow inside
  `createValidatedHandler` is unchanged.
- `src/route-descriptor.ts` drops `formRequest`, `binaryResponse` and
  `textResponse`, widens `any` to `unknown` in the `Any*` aliases, and adds a
  400 `jsonResponse` overload.
- `src/endpoint.ts` renames the `unique symbol` from `__untyped` to
  `untypedSentinel`.
- `src/__tests__/typed-routes.test.ts` drops upstream's string-path tests with
  the overloads and adds three house cases (malformed descriptor, wrong method,
  JSON POST validation).

## Re-vendor recipe

Clone upstream at a newer commit, diff `packages/hono-typed-routes/src`
against this directory ignoring the notice lines, re-apply the edits above,
update the commit pin here, and run this package's tests.
