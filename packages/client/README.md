# @repo/client

What the library tab and the phone share above `@repo/contract`. It names no
platform and no UI: each device draws it in its own way (the tab with
`@repo/ui`, the phone with React Native) over the same rows, words and sends.

## Layout

- `src/account-socket.ts` — the account's socket on partysocket: its ticket per
  try, the cell's keepalive, a silent socket dropped, its frames read, and the
  host's online/offline gate.
- `src/library-cache.ts` — what each frame reads again of a device's TanStack
  queries, which items moved, the reply the agent is writing, and the one
  retry rule for a read.
- `src/library-labels.ts` — a kind's word, the kind chips in order, what a
  scope asks the listing and where a save from it lands.
- `src/thread-entries.ts` — a thread's stored events folded once by
  `conversationOf` into what a conversation draws, the approvals still waiting,
  what a card says, and the person's words for a tool, an ending, an answer, a
  refused send and a thread's state.
- `src/agent-send.ts` — what a send asks the cell: the person's words, the
  thread, and the screen they left from (`viewContextOf`).

## Tests

`pnpm --filter @repo/client test` runs each module's suite under node.
