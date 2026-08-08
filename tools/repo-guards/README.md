# @repo/repo-guards

Derived fitness tests over the repository itself. Ships nothing, exports
nothing, and is a workspace member only so `pnpm test` runs it.

## Why it is its own package

These checks read the WHOLE tree — `CLAUDE.md`, every `packages/*/package.json`,
every source file under `apps/` — so they belong to no product package. Putting
the dep-DAG check in `@repo/notes` would give one package an opinion about
another's manifest; putting the dead-channel check in `@repo/bridge` would make
that package depend on its own consumers. Here they depend on the repo, which is
what they are actually about.

Every one of them is DERIVED: it computes the answer from the tree rather than
comparing against a list someone maintains. That is the difference between a
guard and a chore — a hand-kept list rots into a rubber stamp, and the failure
mode is silence.

```bash
pnpm --filter @repo/repo-guards test    # node environment, no build output
```

## What each suite pins

### `src/dep-dag.test.ts` — two assertions, not one

**1. `CLAUDE.md`'s "Dep DAG" paragraph against the real manifests, in BOTH
directions.** The paragraph is the map agents read before deciding where code
may live, and it is the one piece of prose in this repo that restates data the
compiler already owns — a `pnpm add` inside a package cannot break it, so it
would silently become fiction. So it is parsed, not trusted: the `x→a+b+c`
clauses and the `… are leaves` clause are diffed against the `@repo/*` edges in
every `packages/*/package.json` (dependencies, devDependencies and
peerDependencies all count — a devDependency is as real an edge as a runtime one
for "may this import that"). An undocumented dep fails. A documented edge the
manifest no longer has fails. A package the paragraph never mentions fails.

The prose stays hand-written, because it carries WHY and no generator can emit
that. Only its factual claims are pinned.

**2. Nothing `packages/` SHIPS imports `node:` or `electron`.** Every one of
those packages is bundled into a browser, and `notes` + `bridge` into workerd and
React Native too. The walk covers shipped source only — `__tests__` and
`*.test.ts` are excluded, because these packages' tests walk the filesystem on
purpose. That exclusion is precisely the hole a per-package lint override would
leave open, which is why the check lives here rather than in `.oxlintrc.json`
(which does carry the rule for `notes` and `bridge`, where no exception exists).

### `src/no-dead-channels.test.ts` — every Bridge channel has a caller

Adding a channel costs three edits (registry entry, host handler, fixture stub)
and the compiler enforces all three — so a channel whose CALLER later disappears
leaves a fully implemented, fully typechecked, permanently unreachable surface
behind. **knip structurally cannot see it**: it sees the registry entry used by
the handler map, and the handler used by the registry.

So `IPC_METHODS` is resolved from `@repo/bridge` and each name is searched for
across `apps/`, `packages/`, `tools/`, `docs/` and `.claude/`, minus a SUPPLY
set — files that mention every method by construction:

- `ipc-registry.ts`, `channel-policy.ts`, the fixture Bridge, and any file matching
  `/(?:[a-z-]*handlers|handler-registry)\.ts$/` (the host's registrations are
  spread across the Worker's feature folders, so the exclusion is by name).
- **`agent-grants.ts`**, for the sharpest version of the same reason: it
  partitions the whole non-event registry by construction, and most of what it
  names, it names in order to DENY. Left in the corpus it would keep nearly
  every channel looking alive.
- **The two blueprint skills** (`add-bridge-channel`, `add-editor-node`). They
  quote real channels as WORKED EXAMPLES of the mechanism, never as callers —
  counting the mention as demand would prop a dead channel up forever. Outside
  those two files, naming a channel in prose DOES count as demand, so do not
  write a channel's name into a doc to keep this green.

Deliberately conservative: it matches bare identifiers, so a channel whose name
is also an ordinary word could be kept alive by a coincidental mention. It errs
toward passing, which means **a failure here is always real**.

### `src/pi-quarantine.test.ts` — pi imports stay in one folder

`apps/web/container/src/pi/` is the only place allowed to name
`@earendil-works/pi-*`; the daemon, the reporter, the vault watcher and the tool
relays speak the image's own vocabulary. pi moves fast, and a leaked import
turns every upstream rename into a change across the whole image. The container
package has no test script of its own and no lint override names pi, so without
this the rule was a sentence in a README that a violation would ship past.

Import specifiers only — `container/src/tools.ts` names pi in prose, explaining
the vocabulary the quarantine exists to keep, and a guard that counted that
would forbid the comment rather than the coupling. A second assertion checks the
quarantine still contains pi imports, so a regex that stops matching fails loudly
instead of passing over an empty set.

## The maintenance contract

- **Every suite carries a FLOOR, and the floors are the point.** A notation
  change in the Dep DAG paragraph that stops the parse matching anything would
  otherwise pass vacuously; so would a moved container source tree, or a walk
  that finds no files. If you change how something is spelled, expect the floor
  to fail first — that is it working.
- **Re-anchor, do not delete.** A red guard means the tree and its record
  disagree. Fix whichever is wrong: the dependency or the paragraph, the caller
  or the channel, the import or the quarantine. Deleting the assertion converts
  a five-minute diff into a permanent blind spot, and every one of these exists
  because the thing it checks had already drifted once.
- **The dead-channel SUPPLY list is the one hand-maintained thing here.** A new
  handler file whose name does not match `*handlers.ts` / `handler-registry.ts`
  will make its live channels look dead. Add the file to the pattern or rename
  it; do not add channels to an ignore list.
