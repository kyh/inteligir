# @repo/editor-bridge — the phone editor page's wire

Every frame the phone's editor page (`@repo/mobile-editor`) and the native
screen that hosts it (`@repo/mobile`) send each other, in zod, parsed by the end
that receives it. It is a package of its own because the two ends build apart:
the page is DOM React under Vite, the React Compiler and TypeScript 7, and the
phone is React Native under Metro and TypeScript 6, so the phone reaches the
wire and never the page's source (`tools/repo-guards/src/dep-dag.test.ts`,
`EDITOR_PAGE_CLIENTS`).

Both ends ship in one binary, so the wire breaks freely: no version field, no
negotiation. Its imports are zod and the grammars of `@repo/notes`, and it
compiles at ES2023 with no ambient types,
the ceiling of Hermes and of the phone's WebKit from iOS 16.4.

The frames, their timeouts and the door native calls are described in
`apps/mobile-editor/README.md` § The bridge.

```
src/
  protocol.ts   every frame both ends send, its parse, and the script native injects
```
