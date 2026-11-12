# @repo/repo-guards

Fitness tests over the repo itself, for the rules that span workspaces and no
tool checks. Each walks the real tree and fails with its rule and the file to
change.

- `product-words.test.ts`: no product surface says an engine's word
  (`AGENTS.md` § Rules that matter), or the file is an `ALLOWED` row.
- `compiled-hook-shapes.test.ts`: no react source defines a `use*` hook inside
  another function, which the React Compiler breaks with no diagnostic.
- `d1-unique-index.test.ts`: no `d1-http` schema declares `.unique()`, whose
  table recreate cascades deletes on the production D1.
- `remote-media.test.ts`: the library tab's, the Mac's and the phone's editor
  content policies let no item draw from the web.

`src/repo.ts` is the one tree walk they share: pnpm's workspaces, a
workspace's source files, and `sourceOf`, which drops full-line comments.

```sh
pnpm --filter @repo/repo-guards test
```
