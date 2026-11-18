# Decisions: @repo/client

What the library tab and the phone share above the contract, and the extension the waiting saves.
It names no platform and no UI (`oxlint.config.ts`), so the Mac's window, the tab and the phone
say one thing of one library.

## The library on a device

- **A device learns what moved by asking `library.changes` for what moved after the head it
  holds: one query observer, every 15 s while in front, at once on focus and reconnect.** Its beat,
  focus and reconnect are TanStack's own, so the host drives one focus and one online manager; the
  cloud holds no socket, and refetching every screen instead reads the whole library each time and
  never tells an open note its item moved. `packages/client/src/library-changes.ts`.
- **One module says what an answer of what moved reads again, for the tab and the phone alike.** An
  item's read goes again only when the copy held is older than the answer's sequence, and a
  thread's by its key, since a copy per device drifts. `packages/client/src/library-cache.ts`.

## A save that waits

- **A waiting save is one queue over its host's key-value store, and a call's outcome moves a save
  one way.** One record shape and one pass for the phone's shares and the extension's saves, and
  one the library refuses is parked with its words, since a queue per host lets one drop what
  another parks. `packages/client/src/waiting-saves.ts`.
- **The queue reads its store at every step and changes it one step at a time.** Nothing rests on
  memory a stopped host loses, and a try's answer never brings back a save let go while its call
  was on its way, since a read and a write a clear can land between is a save that returns.
  `packages/client/src/waiting-saves.ts`.

## The agent's panel

- **A conversation's logic is one package, and each device draws it** (owner decision). Pure
  functions over the contract's union, so the Mac, the tab and the phone say one thing of one
  conversation. `packages/client/src/agent-send.ts`.
- **A conversation is read once, in order, and each call has one state; a turn is under way from
  a message until a turn ends.** `conversationOf` is every device's one way in, and reads Stop off
  the events, since a message sent mid-turn joins the turn and the thread list lags the stream.
  `packages/client/src/thread-entries.ts`.
- **A thread's events are one query that follows its stream from after the last one held.** A
  stream the cloud cut or a device left picks up by `lastEventId`, so nothing reads a whole
  conversation again, and an answer of what moved never restarts it.
  `packages/client/src/thread-queries.ts`.
