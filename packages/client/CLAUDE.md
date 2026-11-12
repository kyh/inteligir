# Decisions: @repo/client

What the library tab and the phone share above the contract. It names no platform and no UI
(`oxlint.config.ts`), so the Mac's window, the tab and the phone say one thing of one library.

## The library on a device

- **The account's socket is partysocket's, and only its keepalive, its frames and its
  online/offline gate are ours.** Its ticket is the URL provider and its backoff partysocket's, since
  a hand-rolled redial machine is ours forever. `packages/client/src/account-socket.ts`.
- **One module says what a frame reads again, for the tab and the phone alike.** An item's read goes
  again only when the copy held is older than the frame's sequence, and a thread's by its key, since
  a copy per device drifts. `packages/client/src/library-cache.ts`.

## The agent's panel

- **A conversation's logic is one package, and each device draws it** (owner decision). Pure
  functions over the contract's union, so the Mac, the tab and the phone say one thing of one
  conversation. `packages/client/src/agent-send.ts`.
- **An approval says what its call would do, read off the call.** A card counts what a delete would
  move and shows the whole address a save would send, since the card is the one gate on a call a
  hostile page may have prompted. `packages/client/src/thread-entries.ts`.
- **A conversation is read once, in order, and each approval and call has one state.**
  `conversationOf` is every device's one way in, since a set of answered calls over the whole thread
  hides an ask its answer arrives before. `packages/client/src/thread-entries.ts`.
