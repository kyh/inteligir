# @repo/domain

The zod-only leaf: the library scopes a screen shows and the view context a
message to the built-in agent carries. The library's page, the phone and the
account's cell parse the same shapes with it, so it holds schemas and nothing
else — no node, no transport, no React.

## Why it exists

A scope is the page's remembered pref, the items listing's filter and part of
the context a message carries to the cell, and each parses it at its own
boundary. One spelling in one package with one runtime dependency is what
makes that the same parse on every target. The leaf-ness is held by
`tools/repo-guards/src/dep-dag.test.ts` — `@repo/domain` is declared with no
outgoing edge, and the zod-only-leaf check refuses any `dependencies` entry but
`zod`, because a second runtime dep here ships to every consumer — by
`oxlint.config.ts`, which refuses its source a node or react import, and by
`tsconfig.json` (`ES2023`, `types: []`), so a node global is a type error
before it is a lint error.

Consumers: `@repo/contract`, `@repo/agent-panel`, the library's page and the
phone.

## Layout

```
src/
  library-scope.ts   # which part of the library a screen shows, in its one spelling
  view-context.ts    # the screen a message left from
```

Every subpath is exported by name in `package.json`; there is no barrel.

## Invariants

- **A view context rides the message.** Never a thread column, never a
  mutable "current view": it describes the screen a message left from, so
  nothing reconciles it on navigation.

## Testing

`pnpm --filter @repo/domain test` — vitest.
