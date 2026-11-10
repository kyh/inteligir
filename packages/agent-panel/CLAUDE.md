# Decisions: @repo/agent-panel

The built-in agent's panel as every device reads it. `AGENTS.md` § Decisions
says how a bullet is written and cited.

## The panel

- **A CONVERSATION'S LOGIC IS ONE PACKAGE, AND EACH DEVICE DRAWS IT** (owner
  decision: the phone gets the built-in agent). The events a thread's rows
  carry, folded into what a conversation draws, the approval waiting, each
  turn's ending, the person's words for each state and refusal, and what a
  send asks (the words, the thread and the screen it leaves from) are pure
  functions over the contract's own union, so the Mac, the tab and the phone
  say one thing of one conversation. It holds only what every device draws:
  Undo and Tidy my library are the page's
  (`apps/web/src/library/agent/thread-undo.ts`, `tidy-library.ts`), since the
  phone has neither, and the reply being written is each device's, kept as its
  socket carries it (`apps/web/src/library/cloud/use-library-socket.ts`,
  `apps/mobile/src/lib/thread-previews.ts`). It imports no platform and no UI
  (`oxlint.config.ts`): the page draws it with `@repo/ui`
  (`apps/web/src/library/agent/agent-panel.tsx`), the phone natively.
  Rejected: the phone drawing the page's panel in a WebView (a second page, and
  the composer under a soft keyboard the page cannot lay out); a copy of the
  fold per device (the words drift); one device's modules kept here (the
  package would claim for every device what one draws).
  `packages/agent-panel/src/thread-entries.ts`, `agent-send.ts`.

- **AN APPROVAL SAYS WHAT ITS CALL WOULD DO, READ OFF THE CALL.** A card counts
  the items a delete would move and names the first it holds, and shows the
  whole address a save would send a site, read off the event's input, because
  the card is the one gate on a call a hostile page may have prompted. Rejected:
  a fixed sentence per tool beside the agent's own reply (the reply is what such
  a page writes); a title the cell puts on the event (every device already
  holds it). `packages/agent-panel/src/thread-entries.ts`.

- **A CONVERSATION IS READ ONCE, IN ORDER, AND EACH APPROVAL AND CALL HAS ONE
  STATE.** `conversationOf` is every device's one way in: an approval waits
  until the person answers it or its turn ends, which lapses it, so a turn that
  stopped or failed leaves no card to answer; a call runs until its one result,
  which lands on it wherever its run is drawn, since a call that waited on the
  person answers after its approval closed that run; an answer or a result
  before its ask or its call is skipped. An approval's row says who settled
  it: the person, its time running out, or the turn stopped. Rejected: the
  answered calls as a set over the whole thread (an answer before its ask hid
  the ask, and a question its turn outlived stayed up); a result matched within
  its own run alone (a call the person approved stayed running for good).
  `packages/agent-panel/src/thread-entries.ts`.
