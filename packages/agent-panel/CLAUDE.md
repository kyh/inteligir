# Decisions: @repo/agent-panel

The built-in agent's panel as every device reads it.

## The panel

- **A conversation's logic is one package, and each device draws it** (owner decision). Pure
  functions over the contract's union, importing no platform or UI, so the Mac, the tab and the
  phone say one thing of one conversation. `packages/agent-panel/src/agent-send.ts`.
- **An approval says what its call would do, read off the call.** A card counts what a delete would
  move and shows the whole address a save would send, since the card is the one gate on a call a
  hostile page may have prompted. `packages/agent-panel/src/thread-entries.ts`.
- **A conversation is read once, in order, and each approval and call has one state.**
  `conversationOf` is every device's one way in, since a set of answered calls over the whole thread
  hid an ask its answer arrived before. `packages/agent-panel/src/thread-entries.ts`.
