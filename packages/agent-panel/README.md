# @repo/agent-panel

The built-in agent's panel as every device reads it. A conversation is the
account's, the same on the Mac, in the browser tab and on the phone, so what a
panel makes of it is one package: each device draws it in its own way (the
library's page with `@repo/ui`, the phone with React Native) over the same
rows, words and sends. It names no platform and no UI, and holds only what
every device draws: Undo and Tidy my library are the page's own
(`apps/web/src/library/agent/`), and each device keeps the reply being written
as its socket carries it.

## Layout

- `src/thread-entries.ts` — a thread's stored events parsed by the contract's
  own union (`@repo/contract/library/agent-events`), folded once by
  `conversationOf` into what a conversation draws (messages, runs of work,
  answered approvals, each turn's ending) and the approvals still waiting,
  what a card says, and the person's words for a tool, an ending, an answer, a
  refused send and a thread's state.
- `src/agent-send.ts` — what a send asks the cell: the person's words, the
  thread, and the screen they left from (`viewContextOf`), and what the field
  says before anything is typed.

## Tests

`pnpm --filter @repo/agent-panel test` runs each module's suite under node.
