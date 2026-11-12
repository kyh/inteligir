# @repo/client

What the library tab and the phone share above `@repo/contract`. It names no
platform and no UI: each device draws it in its own way (the tab with
`@repo/ui`, the phone with React Native) over the same rows, words and sends.

## Layout

- `src/thread-entries.ts` — a thread's stored events folded once by
  `conversationOf` into what a conversation draws, the approvals still waiting,
  what a card says, and the person's words for a tool, an ending, an answer, a
  refused send and a thread's state.
- `src/agent-send.ts` — what a send asks the cell: the person's words, the
  thread, and the screen they left from (`viewContextOf`).

## Tests

`pnpm --filter @repo/client test` runs each module's suite under node.
