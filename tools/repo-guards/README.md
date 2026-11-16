# @repo/repo-guards

Fitness tests over the repo itself, for the rules that span workspaces and no
tool checks. Each walks the real tree and fails with its rule and the file to
change.

- `product-words.test.ts`: no product surface says an engine's word
  (`AGENTS.md` § Rules that matter), or the file is an `ALLOWED` row.

`src/repo.ts` is the tree walk a guard reads through: pnpm's workspaces, a
workspace's shipped source files, and `sourceOf`, which drops full-line comments.

```sh
pnpm --filter @repo/repo-guards test
```
