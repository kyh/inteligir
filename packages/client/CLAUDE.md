# Decisions: @repo/client

What the library tab and the phone share above the contract. It names no platform and no UI
(`oxlint.config.ts`), so the Mac's window, the tab and the phone say one thing of one library.

## The library on a device

- **Every socket to the cloud is one live socket, partysocket's, and only its keepalive and its
  gate on the host's `Reach` are ours.** The account's and each note's differ by address, beat and
  backoff alone; its ticket is the URL provider and its redial partysocket's, since a second redial
  machine is ours forever, and it subscribes to the reach itself, since a host that pushes each edge
  holds a second copy. `packages/client/src/live-socket.ts`.
- **One module says what a frame reads again, for the tab and the phone alike.** An item's read goes
  again only when the copy held is older than the frame's sequence, and a thread's by its key, since
  a copy per device drifts. `packages/client/src/library-cache.ts`.

## A save that waits

- **A waiting save is one queue over its host's key-value store, and a call's outcome moves a save
  one way.** One record shape and one pass for every host that keeps a save, and one the library
  refuses is parked with its words, since a queue per host lets one drop what another parks.
  `packages/client/src/waiting-saves.ts`.
- **The queue reads its store at every step and changes it one step at a time.** Nothing rests on
  memory a stopped host loses, and a try's answer never brings back a save let go while its call
  was on its way, since a read and a write a clear can land between is a save that returns.
  `packages/client/src/waiting-saves.ts`.

## The agent's panel

- **A conversation's logic is one package, and each device draws it** (owner decision). Pure
  functions over the contract's union, so the Mac, the tab and the phone say one thing of one
  conversation. `packages/client/src/agent-send.ts`.
- **An approval says what its call would do, as its event carries it.** A card counts what a delete
  would move and shows the whole address a save would send, since the card is the one gate on a
  call a hostile page may have prompted; an ask this build does not know claims nothing and still
  answers. `packages/client/src/thread-entries.ts`.
- **A conversation is read once, in order, and each approval and call has one state.**
  `conversationOf` is every device's one way in, since a set of answered calls over the whole thread
  hides an ask its answer arrives before. `packages/client/src/thread-entries.ts`.
- **A thread's read is spelled once, beside the socket that reads it again.** Its events are one
  query that asks only for what came after the last one held, since a paged copy downloads the
  whole conversation on every frame of a turn. `packages/client/src/thread-queries.ts`.
- **The reply being written goes when the read that brings its stored message lands.** A preview
  let go on the frame leaves neither text on screen for a round trip, and one the agent wrote
  more of meanwhile is the next message's. `packages/client/src/library-cache.ts`.
